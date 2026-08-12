import { existsSync } from "node:fs";
import {
	bankPath,
	projectIndexSource,
	projectName,
	recallBudget,
	recallCap,
	recallEnabled,
	recallFloor,
	recallIndexes,
} from "./config";
import { renderRecallBlock } from "./core";

type Row = { content?: unknown };

type Reader = {
	all(sql: string, parameters: readonly unknown[]): Row[];
	close(): void;
};

/**
 * Bun ships `bun:sqlite`; Node ships `node:sqlite`. The specifier is a `string`
 * rather than a literal so the type checker leaves it alone — neither module
 * resolves under the other runtime's types.
 *
 * The read-write fallback is not optional. A WAL database needs its `-shm`
 * file, and a read-only connection is not permitted to create one, so the
 * read-only open fails outright whenever no other process currently holds the
 * bank open. Neither call ever issues a write.
 */
async function open(path: string): Promise<Reader> {
	// The read-write fallback below would otherwise create an empty bank here.
	if (!existsSync(path)) throw new Error("bank not found");

	if (process.versions.bun) {
		const specifier: string = "bun:sqlite";
		const { Database } = (await import(specifier)) as {
			Database: new (path: string, options: { readonly?: boolean; readwrite?: boolean; create?: boolean }) => {
				query(sql: string): { all(...parameters: unknown[]): Row[] };
				close(): void;
			};
		};
		const reader = (database: InstanceType<typeof Database>): Reader => ({
			all: (sql, parameters) => database.query(sql).all(...parameters),
			close: () => database.close(),
		});
		return openReadable(
			() => reader(new Database(path, { readonly: true })),
			() => reader(new Database(path, { readwrite: true, create: false })),
		);
	}

	const specifier: string = "node:sqlite";
	const { DatabaseSync } = (await import(specifier)) as {
		DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
			prepare(sql: string): { all(...parameters: unknown[]): Row[] };
			close(): void;
		};
	};
	const reader = (database: InstanceType<typeof DatabaseSync>): Reader => ({
		all: (sql, parameters) => database.prepare(sql).all(...parameters),
		close: () => database.close(),
	});
	return openReadable(
		() => reader(new DatabaseSync(path, { readOnly: true })),
		() => reader(new DatabaseSync(path)),
	);
}

/**
 * Bun opens lazily, so a read-only connection to a WAL bank with no `-shm`
 * fails on first query rather than on construction. The probe forces that
 * failure here, where the fallback can still answer it.
 */
function openReadable(readOnly: () => Reader, readWrite: () => Reader): Reader {
	let reader: Reader | undefined;
	try {
		reader = readOnly();
		reader.all("SELECT 1", []);
		return reader;
	} catch {
		try {
			reader?.close();
		} catch {}
		return readWrite();
	}
}

const live = `superseded_by IS NULL
	AND consolidated_at IS NULL
	AND (valid_until IS NULL OR valid_until > datetime('now'))`;

/** Every row repeats a "[source] heading" breadcrumb that recall can re-derive. */
function stripBreadcrumb(content: string): string {
	return content.replace(/^\[[^\]]+\]\s*/, "");
}

function contents(rows: readonly Row[]): string[] {
	return rows.flatMap(row => {
		if (typeof row.content !== "string") return [];
		const value = stripBreadcrumb(row.content).trim();
		return value ? [value] : [];
	});
}

async function read(query: (reader: Reader) => Row[], path: string): Promise<string[]> {
	let reader: Reader | undefined;
	try {
		reader = await open(path);
		return contents(query(reader));
	} catch {
		return [];
	} finally {
		try {
			reader?.close();
		} catch {}
	}
}

/**
 * Indexes join the block below the floor: they are the pointers that make
 * recall-on-demand possible, and a floor high enough to hold rule bodies out
 * would hold them out too.
 */
export function readGlobalRules(floor: number, indexes: readonly string[], path = bankPath()): Promise<string[]> {
	const placeholders = indexes.map(() => "?").join(", ");
	const sql = `SELECT content FROM working_memory
		WHERE scope = 'global'
			AND ${live}
			AND (importance >= ?${placeholders ? ` OR source IN (${placeholders})` : ""})
		ORDER BY importance DESC, timestamp DESC`;

	return read(reader => reader.all(sql, [floor, ...indexes]), path);
}

export function readProjectIndex(source: string, path = bankPath()): Promise<string[]> {
	const sql = `SELECT content FROM working_memory
		WHERE source = ?
			AND ${live}
		ORDER BY timestamp DESC`;

	return read(reader => reader.all(sql, [source]), path);
}

/** The session's one automatic recall: standing rules plus the current project's index. */
export async function sessionRecall(cwd?: string): Promise<string | undefined> {
	if (!recallEnabled()) return undefined;

	const source = projectIndexSource(cwd);
	const [rules, index] = await Promise.all([
		readGlobalRules(recallFloor(), recallIndexes()),
		readProjectIndex(source),
	]);

	return renderRecallBlock(rules, index, {
		project: projectName(cwd),
		indexSource: source,
		cap: recallCap(),
		budget: recallBudget(),
	});
}
