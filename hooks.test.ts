import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleHook, parseAgyTranscript, type HookOperations } from "./hooks";

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
		prompt: "latest request",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "next request",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		stop_hook_active: true,
		last_assistant_message: "partial answer",
	}, value, state);

	expect(calls.remember).toEqual([{
		content: "User:\nlatest request\n\nAssistant:\ncompleted answer",
		metadata: { host: "claude", claude_session_id: "session-1", claude_turn_id: "active" },
	}]);
});

test("AGY recalls and retains from its experimental transcript parser", async () => {
	const state = await stateDirectory();
	const transcript = join(state, "transcript.jsonl");
	const { calls, value } = operations();
	await writeFile(transcript, `${JSON.stringify({ source: "USER_INPUT", content: "<USER_REQUEST>latest request</USER_REQUEST>" })}\n`);

	expect(await handleHook("agy", {
		hook_event_name: "PreInvocation",
		conversationId: "conversation-1",
		transcriptPath: transcript,
	}, value, state)).toEqual({ injectSteps: [{ ephemeralMessage: "<memories>retained</memories>" }] });

	await writeFile(transcript, [
		JSON.stringify({ source: "USER_INPUT", content: "<USER_REQUEST>latest request</USER_REQUEST>" }),
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
		content: "User:\nlatest request\n\nAssistant:\ncompleted answer",
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
		prompt: "latest request",
	}, unavailable, state)).toEqual({});
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
