import { afterEach, expect, mock, test } from "bun:test";

type Call = { tool: string; args: Record<string, unknown> };

const calls: Call[] = [];

function response(tool: string): { content: { type: string; text: string }[] } {
	return {
		content: [{
			type: "text",
			text: tool === "mnemosyne_recall"
				? JSON.stringify({ status: "ok", results: [{ content: "recalled fact" }] })
				: JSON.stringify({ status: "stored", memory_id: "memory-1" }),
		}],
	};
}

mock.module("@modelcontextprotocol/client", () => ({
	Client: class {
		async connect(): Promise<void> {}
		async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
			calls.push({ tool: name, args });
			return response(name);
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
});

test("Pi appends recalled memory to the turn's system prompt", async () => {
	const result = await harness().get("before_agent_start")?.(
		{ prompt: "how does the retention scope work", systemPrompt: "base prompt" },
		{ signal: new AbortController().signal },
	);

	expect(result?.systemPrompt).toContain("base prompt");
	expect(result?.systemPrompt).toContain("recalled fact");
	expect(calls[0]?.args).toMatchObject({ limit: 5 });
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

test("Pi skips acknowledgement turns on both recall and retention", async () => {
	const handlers = harness();

	await handlers.get("before_agent_start")?.({ prompt: "g", systemPrompt: "base prompt" }, { signal: new AbortController().signal });
	await handlers.get("agent_settled")?.({}, context("g"));

	expect(calls).toEqual([]);
});

test("Pi honours the retention opt-out", async () => {
	process.env.MNEMOSYNE_MEMORY_RETAIN = "0";

	await harness().get("agent_settled")?.({}, context("how does the retention scope work"));

	expect(calls).toEqual([]);
});
