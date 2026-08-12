import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mnemosyne = Bun.which("mnemosyne");

function hook(event: string, payload: Record<string, unknown>, environment: Record<string, string>): Record<string, unknown> {
	const result = spawnSync("bun", ["hooks.ts", "claude"], {
		cwd: import.meta.dir,
		input: JSON.stringify({ hook_event_name: event, ...payload }),
		encoding: "utf8",
		timeout: 120_000,
		env: { ...process.env, ...environment },
	});

	expect(result.status).toBe(0);
	return JSON.parse(result.stdout.trim());
}

function bankDatabase(dataDir: string): string {
	const path = join(dataDir, "mnemosyne.db");
	expect(existsSync(path)).toBe(true);
	return path;
}

// Drives the real `mnemosyne mcp` server, so it is skipped when the binary is absent.
// MNEMOSYNE_DATA_DIR redirects the bank to a temp directory — never the user's own.
test.skipIf(!mnemosyne)("a full turn round trips through a real Mnemosyne bank", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "mnemosyne-integration-"));
	const environment = {
		MNEMOSYNE_DATA_DIR: dataDir,
		MNEMOSYNE_MEMORY_STATE_DIR: mkdtempSync(join(tmpdir(), "mnemosyne-integration-state-")),
	};
	const prompt = "explain how the retention policy picks a project namespace";

	expect(hook("UserPromptSubmit", { session_id: "session-1", prompt, cwd: import.meta.dir }, environment)).toBeDefined();
	hook("Stop", { session_id: "session-1", last_assistant_message: "the origin remote name", cwd: import.meta.dir }, environment);

	// Not readonly: the bank is left in WAL mode, and a readonly open cannot create the -wal sidecar.
	const database = new Database(bankDatabase(dataDir));
	const stored = database
		.query("SELECT content, source, scope, importance, valid_until FROM working_memory ORDER BY timestamp DESC LIMIT 1")
		.get() as { content: string; source: string; scope: string; importance: number; valid_until: string } | null;
	database.close();

	expect(stored).not.toBeNull();
	expect(stored?.content).toBe(`User:\n${prompt}\n\nAssistant:\nthe origin remote name`);
	expect(stored?.source).toBe("projects/omp-mnemosyne/claude-session.md");
	expect(stored?.scope).toBe("session");
	expect(stored?.importance).toBe(0.25);
	expect(stored?.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}/);
}, 180_000);
