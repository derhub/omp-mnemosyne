import { afterEach, expect, mock, test } from "bun:test";

type Call = { tool: string; args: Record<string, unknown> };

const calls: Call[] = [];

function response(): { content: { type: string; text: string }[] } {
	return { content: [{ type: "text", text: JSON.stringify({ status: "stored", memory_id: "memory-1" }) }] };
}

mock.module("./bank", () => ({
	sessionRecall: async () => (process.env.MNEMOSYNE_MEMORY_RECALL === "0" ? undefined : "# Mnemosyne Memory\nstanding rules"),
}));

mock.module("@modelcontextprotocol/client", () => ({
	Client: class {
		async connect(): Promise<void> {}
		async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
			calls.push({ tool: name, args });
			return response();
		}
		async close(): Promise<void> {}
	},
}));

mock.module("@modelcontextprotocol/client/stdio", () => ({
	StdioClientTransport: class {
		async close(): Promise<void> {}
	},
}));

const { default: mnemosyneMemory } = await import("./pi");

type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown> | undefined>;

function harness(): Map<string, Handler> {
	const handlers = new Map<string, Handler>();
	mnemosyneMemory({
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
	} as never);
	return handlers;
}

function ctx(): unknown {
	return { cwd: process.cwd(), signal: new AbortController().signal };
}

function context(prompt: string): unknown {
	const entries = [
		{ type: "message", message: { role: "user", content: prompt } },
		{
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "completed answer" }], stopReason: "stop", timestamp: 1 },
		},
	];
	return {
		cwd: process.cwd(),
		signal: new AbortController().signal,
		sessionManager: {
			buildContextEntries: () => entries,
			getSessionId: () => "session-1",
		},
	};
}

afterEach(() => {
	calls.length = 0;
	delete process.env.MNEMOSYNE_MEMORY_RETAIN;
	delete process.env.MNEMOSYNE_MEMORY_RECALL;
});

test("Pi delivers standing memory as a hidden message on the session's first turn", async () => {
	const result = await harness().get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx());

	expect(result?.message).toEqual({
		customType: "mnemosyne-memory",
		content: expect.stringContaining("standing rules"),
		display: false,
	});
	expect(calls).toEqual([]);
});

test("Pi delivers standing memory once per session", async () => {
	const handlers = harness();

	await handlers.get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx());
	const second = await handlers.get("before_agent_start")?.({ prompt: "and the recall floor" }, ctx());

	expect(second).toBeUndefined();
});

test("Pi delivers standing memory again for a session started in the same process", async () => {
	const handlers = harness();

	await handlers.get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx());
	await handlers.get("session_start")?.({}, ctx());
	const afterRestart = await handlers.get("before_agent_start")?.({ prompt: "and the recall floor" }, ctx());

	expect(afterRestart?.message).toBeDefined();
});

test("Pi delivers standing memory to a session opened with a slash-command", async () => {
	const result = await harness().get("before_agent_start")?.({ prompt: "/commit the staged change" }, ctx());

	expect(result?.message).toBeDefined();
});

test("Pi honours the recall opt-out", async () => {
	process.env.MNEMOSYNE_MEMORY_RECALL = "0";

	const result = await harness().get("before_agent_start")?.({ prompt: "how does the retention scope work" }, ctx());

	expect(result).toBeUndefined();
});

test("Pi stores a settled turn under the project namespace at session scope", async () => {
	await harness().get("agent_settled")?.({}, context("how does the retention scope work"));

	expect(calls).toHaveLength(1);
	expect(calls[0]?.tool).toBe("mnemosyne_remember");
	expect(calls[0]?.args).toMatchObject({
		importance: 0.25,
		scope: "session",
		veracity: "unknown",
		metadata: { pi_session_id: "session-1", pi_turn_id: 1 },
	});
	expect(calls[0]?.args.source).toMatch(/^projects\/.+\/pi-session\.md$/);
});

test("Pi skips acknowledgement turns on retention", async () => {
	await harness().get("agent_settled")?.({}, context("g"));

	expect(calls).toEqual([]);
});

test("Pi honours the retention opt-out", async () => {
	process.env.MNEMOSYNE_MEMORY_RETAIN = "0";

	await harness().get("agent_settled")?.({}, context("how does the retention scope work"));

	expect(calls).toEqual([]);
});
