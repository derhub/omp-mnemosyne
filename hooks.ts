import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { formatInteraction, parseRecallResponse, parseRememberResponse, renderMemoryBlock, type McpTextResult } from "./core";

const timeoutMs = 5_000;

type Host = "agy" | "claude" | "codex";

type HookInput = Record<string, unknown>;

export type HookOperations = {
	recall(query: string): Promise<string | undefined>;
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

function statePath(host: Host, sessionId: string, turnId: string, directory: string): string {
	const key = createHash("sha256").update(`${host}\0${sessionId}\0${turnId}`).digest("hex");
	return join(directory, `${key}.json`);
}

async function loadPending(host: Host, sessionId: string, turnId: string, directory: string): Promise<PendingInteraction | undefined> {
	try {
		const value = record(JSON.parse(await readFile(statePath(host, sessionId, turnId, directory), "utf8")));
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

async function clearPending(host: Host, sessionId: string, turnId: string, directory: string): Promise<void> {
	await rm(statePath(host, sessionId, turnId, directory), { force: true });
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
	toolName: "mnemosyne_recall" | "mnemosyne_remember",
	args: Record<string, unknown>,
): Promise<McpTextResult> {
	const signal = AbortSignal.timeout(timeoutMs);
	const client = new Client({ name: "mnemosyne-memory", version: "1.0.0" });
	const transport = new StdioClientTransport({ command: "mnemosyne", args: ["mcp"], stderr: "ignore" });

	try {
		await withAbort(client.connect(transport), signal);
		return (await withAbort(client.callTool({ name: toolName, arguments: args }, { signal }), signal)) as McpTextResult;
	} finally {
		await client.close().catch(() => transport.close());
	}
}

function createOperations(): HookOperations {
	return {
		async recall(query) {
			const result = await callMnemosyne("mnemosyne_recall", { query, limit: 8 });
			return renderMemoryBlock(parseRecallResponse(result));
		},
		async remember(content, metadata) {
			const result = await callMnemosyne("mnemosyne_remember", {
				content,
				importance: 0.5,
				source: `${metadata.host}-session`,
				scope: "global",
				veracity: "unknown",
				metadata,
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

async function handleRecall(host: Host, input: HookInput, operations: HookOperations, directory: string): Promise<Record<string, unknown>> {
	const ids = hostIds(host, input);
	const prompt = host === "agy" ? (await readAgyTranscript(input)).user : text(input.prompt);
	if (!prompt || !ids.sessionId || !ids.turnId) return recallOutput(host, undefined);

	try {
		await savePending(host, ids.sessionId, ids.turnId, { prompt }, directory);
		return recallOutput(host, await operations.recall(prompt.slice(0, 4_000)));
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
	const pending = await loadPending(host, ids.sessionId, ids.turnId, directory);
	if (!pending) return stopOutput(host);

	const assistant = host === "agy"
		? (await readAgyTranscript(input)).assistant
		: text(input.last_assistant_message);
	const interaction = assistant ? formatInteraction(pending.prompt, assistant) : undefined;
	if (!interaction) return stopOutput(host);

	try {
		await operations.remember(interaction, {
			host,
			[`${host}_session_id`]: ids.sessionId,
			[`${host}_turn_id`]: ids.turnId,
		});
		await clearPending(host, ids.sessionId, ids.turnId, directory);
	} catch (error) {
		console.error(`Mnemosyne hook: retain unavailable (${error instanceof Error ? error.message : "unknown error"})`);
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
		return handleRecall(host, input, operations, directory);
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
		process.stdout.write(`${JSON.stringify(await handleHook(host, input, createOperations()))}\n`);
	} catch (error) {
		console.error(`Mnemosyne hook: ${error instanceof Error ? error.message : "invalid input"}`);
		process.stdout.write(`${JSON.stringify(stopOutput(host))}\n`);
	}
}

if (import.meta.main) void main();
