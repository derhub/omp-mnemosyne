import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGlobalRules, readProjectIndex } from "./bank";

type Seed = {
	content: string;
	source?: string;
	scope?: string;
	importance?: number;
	timestamp?: string;
	valid_until?: string | null;
	superseded_by?: string | null;
	consolidated_at?: string | null;
};

let sequence = 0;

async function bank(rows: readonly Seed[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "mnemosyne-bank-test-"));
	const path = join(directory, "mnemosyne.db");
	const database = new Database(path, { create: true });

	database.run(`CREATE TABLE working_memory (
		id TEXT PRIMARY KEY,
		content TEXT NOT NULL,
		source TEXT,
		timestamp TEXT,
		importance REAL DEFAULT 0.5,
		consolidated_at TEXT,
		valid_until TIMESTAMP DEFAULT NULL,
		superseded_by TEXT DEFAULT NULL,
		scope TEXT DEFAULT 'global'
	)`);

	for (const row of rows) {
		sequence += 1;
		database.run(
			`INSERT INTO working_memory (id, content, source, timestamp, importance, consolidated_at, valid_until, superseded_by, scope)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				`memory-${sequence}`,
				row.content,
				row.source ?? "notes.md",
				row.timestamp ?? "2026-08-01T00:00:00Z",
				row.importance ?? 0.5,
				row.consolidated_at ?? null,
				row.valid_until ?? null,
				row.superseded_by ?? null,
				row.scope ?? "global",
			],
		);
	}

	database.close();
	return path;
}

afterEach(() => {
	sequence = 0;
});

test("a global memory at the floor joins the standing rules", async () => {
	const path = await bank([
		{ content: "at the floor", importance: 0.95 },
		{ content: "below the floor", importance: 0.94 },
	]);

	expect(await readGlobalRules(0.95, [], path)).toEqual(["at the floor"]);
});

test("a named index source joins the standing rules below the floor", async () => {
	const path = await bank([
		{ content: "the index", source: "MEMORY.md", importance: 0.1 },
		{ content: "an ordinary memory", source: "notes.md", importance: 0.1 },
	]);

	expect(await readGlobalRules(0.95, ["MEMORY.md"], path)).toEqual(["the index"]);
});

test("session-scoped memories stay out of the standing rules", async () => {
	const path = await bank([{ content: "a stored turn", importance: 1, scope: "session" }]);

	expect(await readGlobalRules(0.95, [], path)).toEqual([]);
});

test("superseded, consolidated, and expired memories are excluded", async () => {
	const path = await bank([
		{ content: "superseded", importance: 1, superseded_by: "memory-99" },
		{ content: "consolidated", importance: 1, consolidated_at: "2026-08-01T00:00:00Z" },
		{ content: "expired", importance: 1, valid_until: "2020-01-01T00:00:00Z" },
		{ content: "live", importance: 1, valid_until: "2999-01-01T00:00:00Z" },
	]);

	expect(await readGlobalRules(0.95, [], path)).toEqual(["live"]);
});

test("standing rules arrive by importance, then by recency", async () => {
	const path = await bank([
		{ content: "older high", importance: 1, timestamp: "2026-08-01T00:00:00Z" },
		{ content: "newer high", importance: 1, timestamp: "2026-08-02T00:00:00Z" },
		{ content: "low", importance: 0.96 },
	]);

	expect(await readGlobalRules(0.95, [], path)).toEqual(["newer high", "older high", "low"]);
});

test("the project index reads its own source, most recent first", async () => {
	const path = await bank([
		{ content: "older entry", source: "projects/demo/MEMORY.md", timestamp: "2026-08-01T00:00:00Z" },
		{ content: "newer entry", source: "projects/demo/MEMORY.md", timestamp: "2026-08-02T00:00:00Z" },
		{ content: "another project", source: "projects/other/MEMORY.md" },
	]);

	expect(await readProjectIndex("projects/demo/MEMORY.md", path)).toEqual(["newer entry", "older entry"]);
});

test("the repeated source breadcrumb is stripped", async () => {
	const path = await bank([{ content: "[feedback/tools.md] the actual fact", importance: 1 }]);

	expect(await readGlobalRules(0.95, [], path)).toEqual(["the actual fact"]);
});

test("a WAL bank reads even when no other process holds it open", async () => {
	const path = await bank([{ content: "in a WAL bank", importance: 1 }]);
	const database = new Database(path);
	database.run("PRAGMA journal_mode = WAL");
	database.close();
	// A read-only connection cannot create the -shm a WAL bank needs.
	rmSync(`${path}-shm`, { force: true });
	rmSync(`${path}-wal`, { force: true });

	expect(await readGlobalRules(0.95, [], path)).toEqual(["in a WAL bank"]);
});

test("a missing bank yields no memories rather than an error", async () => {
	expect(await readGlobalRules(0.95, [], "/nonexistent/mnemosyne.db")).toEqual([]);
	expect(await readProjectIndex("projects/demo/MEMORY.md", "/nonexistent/mnemosyne.db")).toEqual([]);
});

test("a bank without the expected table yields no memories", async () => {
	const directory = await mkdtemp(join(tmpdir(), "mnemosyne-bank-test-"));
	const path = join(directory, "mnemosyne.db");
	new Database(path, { create: true }).close();

	expect(await readGlobalRules(0.95, [], path)).toEqual([]);
});
