import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpTextResult } from "./core";
import { createOperations, handleHook, parseAgyTranscript, type HookOperations } from "./hooks";

function operations(): { calls: { recall: number; remember: Array<{ content: string; metadata: Record<string, string | number> }> }; value: HookOperations } {
	const calls = { recall: 0, remember: [] as Array<{ content: string; metadata: Record<string, string | number> }> };
	return {
		calls,
		value: {
			async recall() {
				calls.recall += 1;
				return "# Mnemosyne Memory\nstanding rules";
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
			additionalContext: "# Mnemosyne Memory\nstanding rules",
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

	expect(calls.recall).toBe(1);
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
	}, value, state)).toEqual({ injectSteps: [{ ephemeralMessage: "# Mnemosyne Memory\nstanding rules" }] });

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

test("hooks fail open when the bank is unavailable", async () => {
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

test("hooks recall once per session and never again", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	const first = await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "latest request for the memory hook",
	}, value, state);
	const second = await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "next request for the memory hook",
	}, value, state);

	expect(first).toHaveProperty("hookSpecificOutput");
	expect(second).toEqual({});
	expect(calls.recall).toBe(1);
});

test("a new session recalls again", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	for (const session_id of ["session-1", "session-2"]) {
		await handleHook("claude", {
			hook_event_name: "UserPromptSubmit",
			session_id,
			prompt: "latest request for the memory hook",
		}, value, state);
	}

	expect(calls.recall).toBe(2);
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

test("an opt-out writes nothing", async () => {
	const directory = await repository("git@github.com:derhub/omp-mnemosyne.git");
	const { calls, value } = mcpCall();
	process.env.MNEMOSYNE_MEMORY_RETAIN = "0";

	await createOperations("claude", directory, value).remember("User:\nq\n\nAssistant:\na", { host: "claude" });

	expect(calls).toEqual([]);
});

test("an acknowledgement still opens the session with standing memory but is not retained", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	expect(await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "g",
	}, value, state)).toHaveProperty("hookSpecificOutput");
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);

	expect(calls.recall).toBe(1);
	expect(calls.remember).toEqual([]);
});

test("a skipped Claude turn clears a stale active prompt", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "retain this stale request",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "g",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "new answer",
	}, value, state);

	expect(calls.remember).toEqual([]);
});

test("hooks restore pending retention after an MCP failure", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();
	const remember = value.remember;
	let failed = true;
	value.remember = async (content, metadata) => {
		if (failed) {
			failed = false;
			throw new Error("offline");
		}
		await remember(content, metadata);
	};

	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "retain after a transient failure",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);

	expect(calls.remember).toHaveLength(1);
});

test("hooks restore pending retention after an incomplete Stop", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "retain after an incomplete stop",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "completed answer",
	}, value, state);

	expect(calls.remember).toEqual([{
		content: "User:\nretain after an incomplete stop\n\nAssistant:\ncompleted answer",
		metadata: { host: "claude", claude_session_id: "session-1", claude_turn_id: "active" },
	}]);
});


test("hooks ignore pending turns marked skipped before cleanup", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();
	const key = createHash("sha256").update("claude\0session-1\0active").digest("hex");
	await writeFile(join(state, `${key}.json`), JSON.stringify({ prompt: "stale request" }));
	await writeFile(join(state, `${key}.ignored`), "");

	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "new answer",
	}, value, state);

	expect(calls.remember).toEqual([]);
});

test("a valid prompt waits for a pending skipped Stop", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "g",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "valid request after a skipped turn",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "skipped answer",
	}, value, state);
	await handleHook("claude", {
		hook_event_name: "Stop",
		session_id: "session-1",
		last_assistant_message: "valid answer",
	}, value, state);

	expect(calls.remember).toEqual([]);
});

test("a slash-command still opens the session with standing memory", async () => {
	const state = await stateDirectory();
	const { calls, value } = operations();

	expect(await handleHook("claude", {
		hook_event_name: "UserPromptSubmit",
		session_id: "session-1",
		prompt: "/commit the staged change",
	}, value, state)).toHaveProperty("hookSpecificOutput");
	expect(calls.recall).toBe(1);
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
