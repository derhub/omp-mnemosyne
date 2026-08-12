import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readGlobalRules, readProjectIndex } from "./bank";
import {
	recallBudget,
	recallCap,
	recallEnabled,
	recallFloor,
	recallIndexes,
	isRetainablePrompt,
	projectIndexSource,
	projectName,
	retainEnabled,
	retentionPolicy,
	serverEnvironment,
} from "./config";
import { formatInteraction, parseRememberResponse, renderRecallBlock, type McpTextResult } from "./core";

const timeoutMs = 5_000;

type Host = "agy" | "claude" | "codex";

type HookInput = Record<string, unknown>;

export type HookOperations = {
	recall(): Promise<string | undefined>;
	remember(content: string, metadata: Record<string, string | number>): Promise<void>;
};

type PendingInteraction = {
	prompt: string;
};

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	const { promise: abortable, resolve, reject } = Promise.withResolvers<T>();
	const abort = () => reject(signal.reason);
	if (signal.aborted) {
		abort();
		return abortable;
	}

	signal.addEventListener("abort", abort, { once: true });
	void promise.then(
		value => {
			signal.removeEventListener("abort", abort);
			resolve(value);
		},
		error => {
			signal.removeEventListener("abort", abort);
			reject(error);
		},
	);
	return abortable;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readStdin(): Promise<string> {
	let output = "";
	for await (const chunk of process.stdin) output += chunk;
	return output;
}

function stateDirectory(): string {
	return process.env.MNEMOSYNE_MEMORY_STATE_DIR
		?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "mnemosyne-memory");
}

function statePath(host: Host, sessionId: string, turnId: string, directory: string, extension = "json"): string {
	const key = createHash("sha256").update(`${host}\0${sessionId}\0${turnId}`).digest("hex");
	return join(directory, `${key}.${extension}`);
}

/** Keyed by session alone: a new session brings a new key, so nothing needs resetting. */
function recalledPath(host: Host, sessionId: string, directory: string): string {
	const key = createHash("sha256").update(`${host}\0${sessionId}\0recalled`).digest("hex");
	return join(directory, `${key}.recalled`);
}

async function claimRecall(host: Host, sessionId: string, directory: string): Promise<boolean> {
	const path = recalledPath(host, sessionId, directory);
	try {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await writeFile(path, "", { flag: "wx", mode: 0o600 });
		return true;
	} catch {
		return false;
	}
}

async function loadPending(path: string): Promise<PendingInteraction | undefined> {
	try {
		const value = record(JSON.parse(await readFile(path, "utf8")));
		const prompt = text(value?.prompt);
		return prompt ? { prompt } : undefined;
	} catch {
		return undefined;
	}
}

async function savePending(host: Host, sessionId: string, turnId: string, pending: PendingInteraction, directory: string): Promise<void> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const path = statePath(host, sessionId, turnId, directory);
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(pending), { mode: 0o600 });
	await rename(temporary, path);
}

async function claimPending(host: Host, sessionId: string, turnId: string, directory: string): Promise<PendingInteraction | undefined> {
	const pending = statePath(host, sessionId, turnId, directory);
	const inFlight = statePath(host, sessionId, turnId, directory, "inflight");
	try {
		await rename(pending, inFlight);
		return loadPending(inFlight);
	} catch {
		return undefined;
	}
}

async function invalidatePending(host: Host, sessionId: string, turnId: string, directory: string): Promise<void> {
	try {
		await rename(
			statePath(host, sessionId, turnId, directory),
			statePath(host, sessionId, turnId, directory, "ignored"),
		);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
}

async function restorePending(host: Host, sessionId: string, turnId: string, directory: string): Promise<void> {
	await rename(
		statePath(host, sessionId, turnId, directory, "inflight"),
		statePath(host, sessionId, turnId, directory),
	);
}

async function clearPending(host: Host, sessionId: string, turnId: string, directory: string, extension = "json"): Promise<void> {
	await rm(statePath(host, sessionId, turnId, directory, extension), { force: true });
}

function stripUserRequest(value: string): string {
	return value.replace(/^\s*<USER_REQUEST>\s*/i, "").replace(/\s*<\/USER_REQUEST>\s*$/i, "").trim();
}

function transcriptText(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(transcriptText).filter(Boolean).join("\n");

	const item = record(value);
	if (!item) return "";
	for (const key of ["text", "content", "message", "value"]) {
		const result = transcriptText(item[key]);
		if (result) return result;
	}
	return "";
}

export function parseAgyTranscript(content: string): { user?: string; assistant?: string } {
	let user: string | undefined;
	let assistant: string | undefined;

	for (const line of content.split("\n")) {
		let entry: Record<string, unknown> | undefined;
		try {
			entry = record(JSON.parse(line));
		} catch {
			continue;
		}
		if (!entry) continue;

		const type = [entry.source, entry.type, entry.role].filter(value => typeof value === "string").join(" ").toUpperCase();
		const value = transcriptText(entry.content ?? entry.message ?? entry.text).trim();
		if (!value) continue;

		if (type.includes("USER") || type.includes("INPUT")) user = stripUserRequest(value) || user;
		if ((type.includes("ASSISTANT") || type.includes("AGENT_RESPONSE") || type.includes("PLANNER_RESPONSE") || type.includes("MODEL"))
			&& !type.includes("TOOL")) assistant = value;
	}

	return { user, assistant };
}

async function readAgyTranscript(input: HookInput): Promise<{ user?: string; assistant?: string }> {
	const path = text(input.transcriptPath);
	if (!path) return {};
	try {
		return parseAgyTranscript(await readFile(path, "utf8"));
	} catch {
		return {};
	}
}

async function callMnemosyne(
	toolName: "mnemosyne_remember",
	args: Record<string, unknown>,
): Promise<McpTextResult> {
	const signal = AbortSignal.timeout(timeoutMs);
	const client = new Client({ name: "mnemosyne-memory", version: "1.0.0" });
	const transport = new StdioClientTransport({
		command: "mnemosyne",
		args: ["mcp"],
		stderr: "ignore",
		env: { ...getDefaultEnvironment(), ...serverEnvironment() },
	});

	try {
		await withAbort(client.connect(transport), signal);
		return (await withAbort(client.callTool({ name: toolName, arguments: args }, { signal }), signal)) as McpTextResult;
	} finally {
		await client.close().catch(() => transport.close());
	}
}

export function createOperations(host: Host, cwd?: string, call = callMnemosyne): HookOperations {
	return {
		async recall() {
			if (!recallEnabled()) return undefined;

			const [rules, index] = await Promise.all([
				readGlobalRules(recallFloor(), recallIndexes()),
				readProjectIndex(projectIndexSource(cwd)),
			]);
			return renderRecallBlock(rules, index, {
				project: projectName(cwd),
				indexSource: projectIndexSource(cwd),
				cap: recallCap(),
				budget: recallBudget(),
			});
		},
		async remember(content, metadata) {
			if (!retainEnabled()) return;
			const result = await call("mnemosyne_remember", {
				content,
				metadata,
				...retentionPolicy(host, cwd),
			});
			parseRememberResponse(result);
		},
	};
}

function hostIds(host: Host, input: HookInput): { sessionId?: string; turnId?: string } {
	if (host === "agy") return { sessionId: text(input.conversationId), turnId: "active" };

	const sessionId = text(input.session_id);
	if (host === "claude") return { sessionId, turnId: text(input.prompt_id) ?? "active" };
	return { sessionId, turnId: text(input.turn_id) };
}

function recallOutput(host: Host, memoryBlock: string | undefined): Record<string, unknown> {
	if (host === "agy") return memoryBlock ? { injectSteps: [{ ephemeralMessage: memoryBlock }] } : { injectSteps: [] };
	if (!memoryBlock) return {};
	return {
		hookSpecificOutput: {
			hookEventName: "UserPromptSubmit",
			additionalContext: memoryBlock,
		},
	};
}

function stopOutput(host: Host): Record<string, unknown> {
	return host === "agy" ? { decision: "allow" } : {};
}

async function handlePrompt(host: Host, input: HookInput, operations: HookOperations, directory: string): Promise<Record<string, unknown>> {
	const ids = hostIds(host, input);
	const prompt = host === "agy" ? (await readAgyTranscript(input)).user : text(input.prompt);
	if (!prompt || !ids.sessionId || !ids.turnId) return recallOutput(host, undefined);

	// Retention wants the prompt worth storing; recall is owed to every session,
	// including one opened with an acknowledgement or a slash-command.
	if (isRetainablePrompt(prompt)) {
		try {
			await savePending(host, ids.sessionId, ids.turnId, { prompt }, directory);
		} catch (error) {
			console.error(`Mnemosyne hook: retention unavailable (${error instanceof Error ? error.message : "unknown error"})`);
		}
	} else {
		try {
			await invalidatePending(host, ids.sessionId, ids.turnId, directory);
		} catch (error) {
			console.error(`Mnemosyne hook: pending retention cleanup unavailable (${error instanceof Error ? error.message : "unknown error"})`);
		}
	}

	try {
		if (!(await claimRecall(host, ids.sessionId, directory))) return recallOutput(host, undefined);
		return recallOutput(host, await operations.recall());
	} catch (error) {
		console.error(`Mnemosyne hook: recall unavailable (${error instanceof Error ? error.message : "unknown error"})`);
		return recallOutput(host, undefined);
	}
}

async function handleRetention(host: Host, input: HookInput, operations: HookOperations, directory: string): Promise<Record<string, unknown>> {
	if (input.stop_hook_active === true || (host === "agy" && input.fullyIdle !== true)) return stopOutput(host);
	if (host === "agy" && input.terminationReason !== "model_stop") return stopOutput(host);

	const ids = hostIds(host, input);
	if (!ids.sessionId || !ids.turnId) return stopOutput(host);
	const pending = await claimPending(host, ids.sessionId, ids.turnId, directory);
	if (!pending) return stopOutput(host);

	const assistant = host === "agy"
		? (await readAgyTranscript(input)).assistant
		: text(input.last_assistant_message);
	const interaction = assistant ? formatInteraction(pending.prompt, assistant) : undefined;
	if (!interaction) {
		try {
			await restorePending(host, ids.sessionId, ids.turnId, directory);
		} catch (error) {
			console.error(`Mnemosyne hook: pending retention restore unavailable (${error instanceof Error ? error.message : "unknown error"})`);
		}
		return stopOutput(host);
	}

	try {
		await operations.remember(interaction, {
			host,
			[`${host}_session_id`]: ids.sessionId,
			[`${host}_turn_id`]: ids.turnId,
		});
	} catch (error) {
		try {
			await restorePending(host, ids.sessionId, ids.turnId, directory);
		} catch (restoreError) {
			console.error(`Mnemosyne hook: pending retention restore unavailable (${restoreError instanceof Error ? restoreError.message : "unknown error"})`);
		}
		console.error(`Mnemosyne hook: retain unavailable (${error instanceof Error ? error.message : "unknown error"})`);
		return stopOutput(host);
	}

	try {
		await clearPending(host, ids.sessionId, ids.turnId, directory, "inflight");
	} catch (error) {
		console.error(`Mnemosyne hook: pending retention cleanup unavailable (${error instanceof Error ? error.message : "unknown error"})`);
	}
	return stopOutput(host);
}

export async function handleHook(
	host: Host,
	input: HookInput,
	operations: HookOperations,
	directory = stateDirectory(),
): Promise<Record<string, unknown>> {
	const event = text(input.hook_event_name);
	if ((host === "agy" && event === "PreInvocation") || (host !== "agy" && event === "UserPromptSubmit")) {
		return handlePrompt(host, input, operations, directory);
	}
	if (event === "Stop") return handleRetention(host, input, operations, directory);
	return stopOutput(host);
}

async function main(): Promise<void> {
	const host = process.argv[2];
	const event = process.argv[3];
	if (host !== "agy" && host !== "claude" && host !== "codex") {
		console.error("Usage: bun hooks.ts <agy|claude|codex> [event]");
		process.exitCode = 2;
		return;
	}

	try {
		const input = record(JSON.parse(await readStdin()));
		if (!input) throw new Error("Hook input must be a JSON object");
		if (event) input.hook_event_name = event;
		const operations = createOperations(host, text(input.cwd));
		process.stdout.write(`${JSON.stringify(await handleHook(host, input, operations))}\n`);
	} catch (error) {
		console.error(`Mnemosyne hook: ${error instanceof Error ? error.message : "invalid input"}`);
		process.stdout.write(`${JSON.stringify(stopOutput(host))}\n`);
	}
}

if (import.meta.main) void main();
