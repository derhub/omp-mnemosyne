import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { MCPManager, callTool } from "@oh-my-pi/pi-coding-agent/mcp";
import {
	extractInteraction,
	parseRecallResponse,
	parseRememberResponse,
	renderMemoryBlock,
	type McpTextResult,
} from "./core";

const serverName = "mnemosyne";
const timeoutMs = 5_000;

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

export default function mnemosyneMemory(pi: ExtensionAPI): void {
	const reportedFailures = new Set<Operation>();
	const retainedTurns = new Set<string>();

	function reportFailure(operation: Operation): void {
		if (reportedFailures.has(operation)) return;
		reportedFailures.add(operation);
		pi.logger.warn(`Mnemosyne extension: ${operation} unavailable`);
	}

	async function callMnemosyne(
		toolName: "mnemosyne_recall" | "mnemosyne_remember",
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpTextResult> {
		const timeout = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const manager = MCPManager.instance();
		if (!manager) throw new Error("MCP manager is unavailable");

		const connection = await withAbort(manager.waitForConnection(serverName), requestSignal);
		return (await callTool(connection, toolName, args, { signal: requestSignal })) as McpTextResult;
	}

	pi.on("before_agent_start", async event => {
		const query = event.prompt.trim().slice(0, 4_000);
		if (!query) return;

		try {
			const result = await callMnemosyne("mnemosyne_recall", { query, limit: 8 });
			const memoryBlock = renderMemoryBlock(parseRecallResponse(result));
			reportedFailures.delete("recall");
			return memoryBlock ? { systemPrompt: [...event.systemPrompt, memoryBlock] } : undefined;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) reportFailure("recall");
		}
	});

	pi.on("session_stop", async event => {
		if (event.stop_hook_active) return;

		const content = extractInteraction(event.messages, event.last_assistant_message);
		if (!content) return;

		const key = `${event.session_id}:${event.turn_id}`;
		if (retainedTurns.has(key)) return;

		try {
			const result = await callMnemosyne(
				"mnemosyne_remember",
				{
					content,
					importance: 0.5,
					source: "omp-session",
					scope: "global",
					veracity: "unknown",
					metadata: {
						omp_session_id: event.session_id,
						omp_turn_id: event.turn_id,
					},
				},
				event.signal,
			);
			if (parseRememberResponse(result)) retainedTurns.add(key);
			reportedFailures.delete("retain");
		} catch (error) {
			if (!event.signal.aborted) reportFailure("retain");
		}
	});
}
