import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpTextResult } from "./core";
import { createOperations, handleHook, parseAgyTranscript, type HookOperations } from "./hooks";

function operations(): { calls: { recall: string[]; remember: Array<{ content: string; metadata: Record<string, string | number> }> }; value: HookOperations } {
	const calls = { recall: [] as string[], remember: [] as Array<{ content: string; metadata: Record<string, string | number> }> };
	return {
		calls,
		value: {
			async recall(query) {
				calls.recall.push(query);
				return "<memories>retained</memories>";
			},
			async remember(content, metadata) {
				calls.remember.push({ content, metadata });
			},
		},
	};
}

async function stateDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "mnemosyne-memory-test-"));
}

test("Codex recalls on submit and retains one completed turn", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	expect(await handleHook("codex", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		turn_id: "turn-1",
		prompt: "remember this request",
	}, value, state)).toEqual({
		hookSpecificOutput: {
			hookEventName: "UserPromptSubmit",
			additionalContext: "<memories>retained</memories>",
		},
	});

	expect(await handleHook("codex", {
		hook_event_name: "Stop",
		session_id: "session-1",
		turn_id: "turn-1",
		last_assistant_message: "completed answer",
	}, value, state)).toEqual({});
	await handleHook("codex", {
		hook_event_name: "Stop",
		session_id: "session-1",
		turn_id: "turn-1",
		last_assistant_message: "completed answer",
	}, value, state);

	expect(calls.recall).toEqual(["remember this request"]);
	expect(calls.remember).toEqual([{
		content: "User:\nremember this request\n\nAssistant:\ncompleted answer",
		metadata: { host: "codex", codex_session_id: "session-1", codex_turn_id: "turn-1" },
	}]);
});

test("Claude retains through its active-turn fallback and skips re-entrant stops", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "latest request for the memory hook",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "next request for the memory hook",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		stop_hook_active: true,
		last_assistant_message: "partial answer",
	}, value, state);

	expect(calls.remember).toEqual([{
		content: "User:\nlatest request for the memory hook\n\nAssistant:\ncompleted answer",
		metadata: { host: "claude", claude_session_id: "session-1", claude_turn_id: "active" },
	}]);
});

test("AGY recalls and retains from its experimental transcript parser", async () => {
	const state = await stateDirectory();
	const transcript = join(state, "transcript.jsonl");
	const { calls, value } = operations();
	await writeFile(transcript, `${JSON.stringify({ source: "USER_INPUT", content: "<USER_REQUEST>latest request for the memory hook</USER_REQUEST>" })}\n`);

	expect(await handleHook("agy", {
		hook_event_name: "PreInvocation",
		conversationId: "conversation-1",
		transcriptPath: transcript,
	}, value, state)).toEqual({ injectSteps: [{ ephemeralMessage: "<memories>retained</memories>" }] });

	await writeFile(transcript, [
		JSON.stringify({ source: "USER_INPUT", content: "<USER_REQUEST>latest request for the memory hook</USER_REQUEST>" }),
		JSON.stringify({ type: "AGENT_RESPONSE", content: "completed answer" }),
	].join("\n"));

	expect(await handleHook("agy", {
		hook_event_name: "Stop",
		conversationId: "conversation-1",
		transcriptPath: transcript,
		fullyIdle: true,
		terminationReason: "model_stop",
	}, value, state)).toEqual({ decision: "allow" });

	expect(calls.remember).toEqual([{
		content: "User:\nlatest request for the memory hook\n\nAssistant:\ncompleted answer",
		metadata: { host: "agy", agy_session_id: "conversation-1", agy_turn_id: "active" },
	}]);
});

test("AGY command dispatch accepts the configured event argument", () => {
	const result = spawnSync("bun", ["hooks.ts", "agy", "PreInvocation"], {
		cwd: import.meta.dir,
		input: JSON.stringify({ conversationId: "conversation-1" }),
		encoding: "utf8",
	});

	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe('{"injectSteps":[]}');
});

test("AGY parser tolerates malformed records and finds the latest messages", () => {
	const transcript = [
		"not json",
		JSON.stringify({ source: "USER_INPUT", content: "<USER_REQUEST>old</USER_REQUEST>" }),
		JSON.stringify({ type: "PLANNER_RESPONSE", content: "old answer" }),
		JSON.stringify({ source: "USER_INPUT", content: "<USER_REQUEST>latest</USER_REQUEST>" }),
		JSON.stringify({ type: "AGENT_RESPONSE", content: [{ text: "final answer" }] }),
	].join("\n");

	expect(parseAgyTranscript(transcript)).toEqual({ user: "latest", assistant: "final answer" });
});

test("hooks fail open when Mnemosyne recall is unavailable", async () => {
	const state = await stateDirectory();
	const unavailable: HookOperations = {
		async recall() {
			throw new Error("offline");
		},
		async remember() {},
	};

	expect(await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt_id: "prompt-1",
		prompt: "latest request for the memory hook",
	}, unavailable, state)).toEqual({});
});

afterEach(() => {
	delete process.env.MNEMOSYNE_MEMORY_RETAIN;
});

type McpCall = (tool: "mnemosyne_recall" | "mnemosyne_remember", args: Record<string, unknown>) => Promise<McpTextResult>;

function mcpCall(): { calls: Array<{ tool: string; args: Record<string, unknown> }>; value: McpCall } {
	const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
	return {
		calls,
		value: async (tool, args) => {
			calls.push({ tool, args });
			return {
				content: [{
					type: "text",
					text: tool === "mnemosyne_recall"
						? JSON.stringify({ status: "ok", results: [{ content: "recalled fact" }] })
						: JSON.stringify({ status: "stored", memory_id: "memory-1" }),
				}],
			};
		},
	};
}

async function repository(remote: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "mnemosyne-hooks-test-"));
	execFileSync("git", ["init", "-q"], { cwd: directory });
	execFileSync("git", ["remote", "add", "origin", remote], { cwd: directory });
	return directory;
}

test.each(["agy", "claude", "codex"] as const)("%s stores turns under the project namespace at session scope", async host => {
	const directory = await repository("git@github.com:derhub/omp-mnemosyne.git");
	const { calls, value } = mcpCall();

	await createOperations(host, directory, value).remember("User:\nq\n\nAssistant:\na", { host });

	expect(calls).toHaveLength(1);
	expect(calls[0]?.tool).toBe("mnemosyne_remember");
	expect(calls[0]?.args).toMatchObject({
		content: "User:\nq\n\nAssistant:\na",
		metadata: { host },
		importance: 0.25,
		source: `projects/omp-mnemosyne/${host}-session.md`,
		scope: "session",
		veracity: "unknown",
	});
	expect(calls[0]?.args.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("an opt-out leaves recall working and writes nothing", async () => {
	const directory = await repository("git@github.com:derhub/omp-mnemosyne.git");
	const { calls, value } = mcpCall();
	process.env.MNEMOSYNE_MEMORY_RETAIN = "0";
	const operations = createOperations("claude", directory, value);

	expect(await operations.recall("what did we decide about retention")).toContain("recalled fact");
	await operations.remember("User:\nq\n\nAssistant:\na", { host: "claude" });

	expect(calls.map(call => call.tool)).toEqual(["mnemosyne_recall"]);
	expect(calls[0]?.args).toMatchObject({ limit: 5 });
});

test("hooks skip acknowledgement turns without recalling or retaining", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	expect(await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "g",
	}, value, state)).toEqual({});
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);

	expect(calls.recall).toEqual([]);
	expect(calls.remember).toEqual([]);
});

test("hooks skip host slash-commands", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	expect(await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "/commit the staged change",
	}, value, state)).toEqual({});
	expect(calls.recall).toEqual([]);
});

test("hooks ignore incomplete retention payloads", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	expect(await handleHook("codex", {
		hook_event_name: "Stop",
		session_id: "session-1",
		turn_id: "turn-1",
	}, value, state)).toEqual({});
	expect(calls.remember).toEqual([]);
});
