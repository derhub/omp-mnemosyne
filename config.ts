import { execFileSync } from "node:child_process";
import { basename, dirname } from "node:path";

export interface RetentionPolicy {
	importance: number;
	source: string;
	scope: string;
	veracity: string;
	valid_until: string;
}

function envText(name: string): string | undefined {
	return process.env[name]?.trim() || undefined;
}

function envNumber(name: string, fallback: number): number {
	const raw = envText(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

export function retainEnabled(): boolean {
	const raw = envText("MNEMOSYNE_MEMORY_RETAIN")?.toLowerCase();
	return raw === undefined || !["0", "false", "off", "no"].includes(raw);
}

export function recallLimit(): number {
	return Math.max(1, Math.trunc(envNumber("MNEMOSYNE_MEMORY_RECALL_LIMIT", 5)));
}

export function minPromptLength(): number {
	return Math.max(0, Math.trunc(envNumber("MNEMOSYNE_MEMORY_MIN_PROMPT", 16)));
}

export function isRetainablePrompt(prompt: string, minLength = minPromptLength()): boolean {
	const value = prompt.trim();
	if (value.length < minLength) return false;

	// ponytail: length + leading-slash heuristic, drops acknowledgements ("g", "yes, do it") and
	// host slash-commands. Swap for a classifier only if real prompts start getting dropped.
	return !/^\/[\w:-]+/.test(value);
}

function git(args: readonly string[], cwd: string): string | undefined {
	try {
		return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
	} catch {
		return undefined;
	}
}

const projectNames = new Map<string, string>();

/**
 * Mirrors the SessionStart injection hook's namespace: remote name, else the main
 * worktree's directory. `--git-common-dir` keeps linked worktrees on the parent repo's
 * namespace instead of giving each worktree its own.
 */
export function projectName(cwd: string = process.cwd()): string {
	const cached = projectNames.get(cwd);
	if (cached !== undefined) return cached;

	const url = git(["rev-parse", "--is-inside-work-tree"], cwd) && git(["config", "--get", "remote.origin.url"], cwd);
	const common = url ? undefined : git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
	const name = url
		? basename(url.replace(/\.git$/, ""))
		: basename(common ? dirname(common) : cwd);

	projectNames.set(cwd, name);
	return name;
}

/**
 * The stdio transport spawns the server with a safe allowlist that omits every
 * MNEMOSYNE_* variable, so an unforwarded server resolves a different data
 * directory than the `mnemosyne` CLI and writes into a bank nothing else reads.
 */
export function serverEnvironment(base: Record<string, string | undefined> = process.env): Record<string, string> {
	const forwarded: Record<string, string> = {};
	for (const [key, value] of Object.entries(base)) {
		if (value && (key.startsWith("MNEMOSYNE_") || key === "HERMES_HOME")) forwarded[key] = value;
	}
	return forwarded;
}

export function expiryDate(days: number, now: Date = new Date()): string {
	return days > 0 ? new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10) : "";
}

export function retentionPolicy(host: string, cwd: string = process.cwd(), now: Date = new Date()): RetentionPolicy {
	return {
		importance: envNumber("MNEMOSYNE_MEMORY_IMPORTANCE", 0.25),
		source: envText("MNEMOSYNE_MEMORY_SOURCE") ?? `projects/${projectName(cwd)}/${host}-session.md`,
		scope: envText("MNEMOSYNE_MEMORY_SCOPE") ?? "session",
		veracity: "unknown",
		valid_until: expiryDate(envNumber("MNEMOSYNE_MEMORY_TTL_DAYS", 14), now),
	};
}
