import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expiryDate, isRetainablePrompt, minPromptLength, projectName, recallLimit, retainEnabled, retentionPolicy, serverEnvironment } from "./config";

const managed = [
	"MNEMOSYNE_MEMORY_RETAIN",
	"MNEMOSYNE_MEMORY_RECALL_LIMIT",
	"MNEMOSYNE_MEMORY_MIN_PROMPT",
	"MNEMOSYNE_MEMORY_IMPORTANCE",
	"MNEMOSYNE_MEMORY_SOURCE",
	"MNEMOSYNE_MEMORY_SCOPE",
	"MNEMOSYNE_MEMORY_TTL_DAYS",
] as const;

afterEach(() => {
	for (const name of managed) delete process.env[name];
});

async function repository(remote?: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "mnemosyne-config-test-"));
	execFileSync("git", ["init", "-q"], { cwd: directory });
	if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: directory });
	return directory;
}

test("retention lands in the current project's namespace at session scope", async () => {
	const directory = await repository("git@github.com:derhub/omp-mnemosyne.git");

	expect(retentionPolicy("claude", directory, new Date("2026-08-12T00:00:00Z"))).toEqual({
		importance: 0.25,
		source: "projects/omp-mnemosyne/claude-session.md",
		scope: "session",
		veracity: "unknown",
		valid_until: "2026-08-26",
	});
});

test("project namespace falls back to the repository directory without a remote", async () => {
	const directory = await repository();

	expect(projectName(directory)).toBe(directory.split("/").pop());
});

test("linked worktrees keep the parent repository's namespace", async () => {
	const directory = await repository("https://github.com/derhub/omp-mnemosyne.git");
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: directory });
	const worktree = join(directory, "..", `${directory.split("/").pop()}-wt`);
	execFileSync("git", ["worktree", "add", "-q", "-b", "feature", worktree], { cwd: directory });

	expect(projectName(worktree)).toBe("omp-mnemosyne");
});

test("retention is disabled by an explicit opt-out", () => {
	process.env.MNEMOSYNE_MEMORY_RETAIN = "0";

	expect(retainEnabled()).toBe(false);
});

test("policy fields are overridable per environment", async () => {
	const directory = await repository();
	process.env.MNEMOSYNE_MEMORY_SOURCE = "claude-session";
	process.env.MNEMOSYNE_MEMORY_SCOPE = "global";
	process.env.MNEMOSYNE_MEMORY_IMPORTANCE = "0.5";
	process.env.MNEMOSYNE_MEMORY_TTL_DAYS = "0";

	expect(retentionPolicy("claude", directory)).toEqual({
		importance: 0.5,
		source: "claude-session",
		scope: "global",
		veracity: "unknown",
		valid_until: "",
	});
});

test("the spawned server inherits the caller's Mnemosyne data directory", () => {
	expect(serverEnvironment({
		MNEMOSYNE_DATA_DIR: "/tmp/bank",
		HERMES_HOME: "/tmp/hermes",
		PATH: "/usr/bin",
		AWS_SECRET_ACCESS_KEY: "leaked",
	})).toEqual({ MNEMOSYNE_DATA_DIR: "/tmp/bank", HERMES_HOME: "/tmp/hermes" });
});

test("a non-positive retention window stores no expiry", () => {
	expect(expiryDate(0, new Date("2026-08-12T00:00:00Z"))).toBe("");
});

test("acknowledgements and slash-commands are not worth a memory round trip", () => {
	expect(isRetainablePrompt("g")).toBe(false);
	expect(isRetainablePrompt("yes, go ahead")).toBe(false);
	expect(isRetainablePrompt("/commit the staged change")).toBe(false);
	expect(isRetainablePrompt("wire the retention policy into the hooks")).toBe(true);
});

test("malformed numeric overrides fall back to the defaults", () => {
	process.env.MNEMOSYNE_MEMORY_RECALL_LIMIT = "not-a-number";
	process.env.MNEMOSYNE_MEMORY_MIN_PROMPT = "";

	expect(recallLimit()).toBe(5);
	expect(minPromptLength()).toBe(16);
});
