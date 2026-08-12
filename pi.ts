import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { sessionRecall } from "./bank";
import { retainEnabled, retentionPolicy, serverEnvironment } from "./config";
import { extractInteraction, parseRememberResponse, type McpTextResult } from "./core";

const timeoutMs = 5_000;
const serverCommand = "mnemosyne";
const serverArgs = ["mcp"];

type Operation = "recall" | "retain";

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

function latestAssistant(messages: readonly unknown[]): unknown {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message !== null && typeof message === "object" && (message as { role?: unknown }).role === "assistant") {
			return message;
		}
	}
}

export default function mnemosyneMemory(pi: ExtensionAPI): void {
	const reportedFailures = new Set<Operation>();
	const retainedTurns = new Set<string>();
	let recalled = false;

	function reportFailure(operation: Operation): void {
		if (reportedFailures.has(operation)) return;
		reportedFailures.add(operation);
		console.warn(`Mnemosyne extension: ${operation} unavailable`);
	}

	async function callMnemosyne(
		toolName: "mnemosyne_remember",
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpTextResult> {
		const timeout = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const client = new Client({ name: "mnemosyne-memory", version: "1.0.0" });
		const transport = new StdioClientTransport({
			command: serverCommand,
			args: serverArgs,
			stderr: "ignore",
			env: { ...getDefaultEnvironment(), ...serverEnvironment() },
		});

		try {
			await withAbort(client.connect(transport), requestSignal);
			return (await withAbort(client.callTool({ name: toolName, arguments: args }), requestSignal)) as McpTextResult;
		} finally {
			await client.close().catch(() => transport.close());
		}
	}

	pi.on("session_start", () => {
		recalled = false;
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (recalled) return;
		recalled = true;

		try {
			const block = await sessionRecall(ctx.cwd);
			reportedFailures.delete("recall");
			return block
				? { message: { customType: "mnemosyne-memory", content: block, display: false } }
				: undefined;
		} catch (error) {
			reportFailure("recall");
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!retainEnabled()) return;

		const messages = ctx.sessionManager.buildContextEntries().flatMap(entry =>
			entry.type === "message" ? [entry.message] : [],
		);
		const assistant = latestAssistant(messages) as { stopReason?: unknown; timestamp?: unknown } | undefined;
		if (!assistant || assistant.stopReason === "aborted" || assistant.stopReason === "error") return;

		const content = extractInteraction(messages, assistant);
		if (!content) return;

		const turnId = typeof assistant.timestamp === "number" ? assistant.timestamp : Date.now();
		const key = `${ctx.sessionManager.getSessionId()}:${turnId}`;
		if (retainedTurns.has(key)) return;

		try {
			const result = await callMnemosyne(
				"mnemosyne_remember",
				{
					content,
					metadata: {
						pi_session_id: ctx.sessionManager.getSessionId(),
						pi_turn_id: turnId,
					},
					...retentionPolicy("pi", ctx.cwd),
				},
				ctx.signal,
			);
			if (parseRememberResponse(result)) retainedTurns.add(key);
			reportedFailures.delete("retain");
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) reportFailure("retain");
		}
	});
}
