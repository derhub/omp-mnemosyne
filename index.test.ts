import { afterEach, expect, mock, test } from "bun:test";

type Call = { tool: string; args: Record<string, unknown> };

const calls: Call[] = [];

function response(): { content: { type: string; text: string }[] } {
	return { content: [{ type: "text", text: JSON.stringify({ status: "stored", memory_id: "memory-1" }) }] };
}

mock.module("@oh-my-pi/pi-coding-agent/mcp", () => ({
	MCPManager: { instance: () => ({ waitForConnection: async () => ({}) }) },
	callTool: async (_connection: unknown, tool: string, args: Record<string, unknown>) => {
		calls.push({ tool, args });
		return response();
	},
}));

mock.module("./bank", () => ({
	sessionRecall: async () => (process.env.MNEMOSYNE_MEMORY_RECALL === "0" ? undefined : "# Mnemosyne Memory\nstanding rules"),
}));

const { default: mnemosyneMemory } = await import("./index");

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => Promise<Record<string, unknown> | undefined>;

const ctx = { cwd: process.cwd() };

function harness(): Map<string, Handler> {
	const handlers = new Map<string, Handler>();
	mnemosyneMemory({
		logger: { warn() {} },
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
	} as never);
	return handlers;
}

function settledTurn(prompt: string): Record<string, unknown> {
	return {
		stop_hook_active: false,
		session_id: "session-1",
		turn_id: "turn-1",
		signal: new AbortController().signal,
		messages: [{ role: "user", content: prompt }],
		last_assistant_message: { role: "assistant", content: [{ type: "text", text: "completed answer" }] },
	};
}

afterEach(() => {
	calls.length = 0;
	delete process.env.MNEMOSYNE_MEMORY_RETAIN;
	delete process.env.MNEMOSYNE_MEMORY_RECALL;
});

test("OMP delivers standing memory as a hidden message on the session's first turn", async () => {
	const result = await harness().get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx);

	expect(result?.message).toEqual({
		customType: "mnemosyne-memory",
		content: expect.stringContaining("standing rules"),
		display: false,
	});
	expect(calls).toEqual([]);
});

test("OMP delivers standing memory once per session", async () => {
	const handlers = harness();

	await handlers.get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx);
	const second = await handlers.get("before_agent_start")?.({ prompt: "and the recall floor" }, ctx);

	expect(second).toBeUndefined();
});

test("OMP delivers standing memory again for a session started in the same process", async () => {
	const handlers = harness();

	await handlers.get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx);
	await handlers.get("session_start")?.({}, ctx);
	const afterRestart = await handlers.get("before_agent_start")?.({ prompt: "and the recall floor" }, ctx);

	expect(afterRestart?.message).toBeDefined();
});

test("OMP delivers standing memory to a session opened with an acknowledgement", async () => {
	const result = await harness().get("before_agent_start")?.({ prompt: "g" }, ctx);

	expect(result?.message).toBeDefined();
});

test("OMP honours the recall opt-out", async () => {
	process.env.MNEMOSYNE_MEMORY_RECALL = "0";

	const result = await harness().get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx);

	expect(result).toBeUndefined();
});

test("OMP stores a settled turn under the project namespace at session scope", async () => {
	await harness().get("session_stop")?.(settledTurn("how does the retention scope work"), ctx);

	expect(calls).toHaveLength(1);
	expect(calls[0]?.tool).toBe("mnemosyne_remember");
	expect(calls[0]?.args).toMatchObject({
		importance: 0.25,
		scope: "session",
		veracity: "unknown",
		metadata: { omp_session_id: "session-1", omp_turn_id: "turn-1" },
	});
	expect(calls[0]?.args.source).toMatch(/^projects\/.+\/omp-session\.md$/);
});

test("OMP skips acknowledgement turns on retention", async () => {
	await harness().get("session_stop")?.(settledTurn("g"), ctx);

	expect(calls).toEqual([]);
});

test("OMP honours the retention opt-out", async () => {
	process.env.MNEMOSYNE_MEMORY_RETAIN = "0";

	await harness().get("session_stop")?.(settledTurn("how does the retention scope work"), ctx);

	expect(calls).toEqual([]);
});
