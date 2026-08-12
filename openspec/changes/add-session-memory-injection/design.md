## Context

See proposal.md — Why.

Four constraints shape the approach.

`mnemosyne_recall` accepts a query, a limit, and scoring weights. It exposes no filter on `scope`, `source`, `importance`, `superseded_by`, or `valid_until`. `mnemosyne_get` reads one row by identifier. The `mnemosyne` command offers `store`, `recall`, `update`, and `delete`, none of them filtered. The queries this change needs cannot be expressed against any existing interface.

Neither host can inject from a session-start handler. `@oh-my-pi/pi-coding-agent` declares `on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>)` and `@earendil-works/pi-coding-agent` declares the same, both without a result type; OMP's event carries only `{ type }`. The one per-turn hook that returns context is `before_agent_start`, whose `BeforeAgentStartEventResult` carries two channels with different lifetimes: `systemPrompt`, documented "Replace the system prompt **for this turn**", and `message`, a `CustomMessage` that both hosts describe as injected into the conversation and persist as a session entry. OMP uses the second channel itself for hidden continuity context under `INTERRUPTED_THINKING_MESSAGE_TYPE`.

`mnemosyne_update` accepts `content` and `importance`. It cannot set `scope`, `source`, or `valid_until`, which are exactly the columns a transition changes.

The bank is SQLite at `${MNEMOSYNE_DATA_DIR:-~/.memories}/mnemosyne.db`, table `working_memory`, carrying `id`, `content`, `source`, `timestamp`, `importance`, `consolidated_at`, `valid_until`, `superseded_by`, and `scope`.

## Goals / Non-Goals

**Goals:**

- One automatic recall per session, and none per turn.
- One block builder and one bank reader shared by all five hosts.
- Recall that survives a session opening with `g` or `/commit`.
- Transitions that preserve a row's identifier, embedding, and recall history.

**Non-Goals:**

- Any automatic retrieval beyond the session's first turn. The agent has the tool and decides when more memory is worth fetching.
- Automatic promotion. Deciding a pattern has recurred across repositories is a judgment call; this change gives it an interface, not a heuristic.
- Re-embedding. Transitions leave `content` untouched, so the stored vector stays valid.
- Recall at compaction. Session start only.

### Retirement of the prompt-ranked recall path

Per-turn recall is removed: the `recall` operation on each host, `renderMemoryBlock`, `parseRecallResponse`, `recallLimit`, and the prompt-ranked MCP round trip. `MNEMOSYNE_MEMORY_RECALL` is reused for session recall and defaults on.

The name stays because the behavior is still recall — it just happens once, at session start, filtered by scope and importance rather than ranked against a prompt.

Retention stays. It is what fills the bank the agent recalls from, and it costs one write on a settled turn rather than a read on every prompt.

The hosts must reach the `mnemosyne` MCP server for agent-triggered recall to work at all. OMP and Claude Code already configure it; Pi needs `pi-mcp-adapter`, which was previously optional and is now required. The extensions still register no tools of their own.

## Decisions

### Deliver as a conversation message, once per session

The block is delivered once per session in every host, through the channel whose lifetime is the session rather than the turn.

Extension hosts return it as `BeforeAgentStartEventResult.message`, a hidden custom message (`display: false`, `customType: "mnemosyne-memory"`). Command hosts return it as `hookSpecificOutput.additionalContext`, and AGY as an `ephemeralMessage`. All three land in the conversation and persist without redelivery.

Alternative considered: `systemPrompt`. Both hosts document it as a per-turn replacement, so a once-per-session write there is present on the first request and absent from the second — standing rules that stop standing after one turn. Re-appending it every turn corrects that but pays a bank read or a cache lookup per turn and diverges from how the command hosts behave. Rejected on both counts.

### Reset the once-per-session marker from `session_start`

Extension hosts register `session_start` for its side effect alone: it clears the recalled flag. OMP's `/new` and Pi's `new`, `resume`, and `fork` reasons all start a session inside a live process, so a module-level flag that only ever sets would starve every session after the first.

Command hosts need no reset. Their marker file is keyed by host and session identifier, and a new session brings a new key. The marker is claimed with an exclusive create, so two hooks racing on the same session still recall once.

Alternative considered: no reset, accepting one recall per process. Silently wrong for anyone who runs more than one session without restarting. Rejected.

### Session recall bypasses `isRetainablePrompt`

The gate exists to keep acknowledgements and slash-commands out of retention. It ran ahead of recall too, which meant a session opened with `/commit` started blind. Recall now runs before the gate, and the gate governs retention alone.

### Read the bank with a runtime-dispatched driver

`bun:sqlite` under Bun, `node:sqlite` under Node, chosen by `process.versions.bun`. A five-line adapter normalizes `new Database(path, { readonly: true }).query(sql).all(...)` against `new DatabaseSync(path, { readOnly: true }).prepare(sql).all(...)`.

Alternatives considered: spawning the `sqlite3` command, which adds an external binary to the requirements and a process spawn per session; and a bundled driver such as `better-sqlite3`, which adds a native build step to a package that currently has one dependency. Both rejected.

Consequence: Bun 1.3.14 has no `node:sqlite`, and Node 22.19 has it only behind `--experimental-sqlite`, so the Pi floor moves to Node 24 where it is unflagged. This is the change's one breaking effect.

### Transition by direct column update

`promote` and `pin` update `scope`, `source`, `importance`, `valid_until`, and `pinned` in place on the named row. Because `content` never changes, the row's embedding, identifier, `recall_count`, and `last_recalled` all stay valid.

`pin` sets `pinned = 1` alongside clearing `valid_until`. The column already carries that meaning in the bank and exempts a row from consolidation, which is what permanence needs; leaving it untouched would put two senses of pinning in one table.

`promote` sets importance from a fixed constant, not from the configured recall floor. The floor is a per-machine display knob read at session time, so deriving a stored value from it makes a row's global reach depend on whichever environment happened to run the promotion.

Alternative considered: `mnemosyne_remember` the new state followed by `mnemosyne_forget` on the old row. Non-atomic, costs a re-embedding, breaks the identifier, and discards recall history. Rejected.

Consequence: this is the first write this package makes outside the MCP path. Writes are confined to `memory.ts`, are explicit operator actions, and touch four metadata columns on one row selected by primary key.

### Project namespace resolves through the existing `projectName`

`config.ts` already resolves remote name, then main-worktree basename, then working directory, with `--git-common-dir` collapsing linked worktrees onto the parent repository. The index source is `projects/<project>/MEMORY.md`, matching what retention writes under and what the shell hook reads.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `MNEMOSYNE_MEMORY_RECALL` | `1` | `0` disables the standing block; recall and retention are unaffected. |
| `MNEMOSYNE_MEMORY_RECALL_FLOOR` | `0.95` | Importance at or above which a global memory joins the block. |
| `MNEMOSYNE_MEMORY_RECALL_INDEXES` | `MEMORY.md,FEEDBACK.md` | Global sources that join the block regardless of importance. |
| `MNEMOSYNE_MEMORY_RECALL_CAP` | `280` | Per-entry character cap on project index entries. |
| `MNEMOSYNE_MEMORY_RECALL_BUDGET` | `12000` | Character cap on the whole block. |

The floor is `0.95` rather than `0.90` on measurement: a bank in real use carries 53 live rows and 15,327 characters at `0.90`, which is roughly four thousand tokens spent before the first prompt is read. The budget is a second bound for the same reason — a floor governs which rows qualify, not how many, so a bank that accumulates high-importance rows outgrows any floor. Rows are admitted in the query's own order, importance then recency, and the first row that would cross the budget ends the block.

## Risks / Trade-offs

- Reading the bank file directly while the MCP server holds it open → the bank is WAL, so readers proceed concurrently with the server's writes; a locked or corrupt file raises, and the caller treats a raise as no block.
- A read-only connection cannot open a WAL bank whose `-shm` file is absent, which is every cold start with no server running → the reader probes with `SELECT 1` and falls back to a read-write connection, which may create `-shm`. It still never writes. Verified against a WAL bank with `-shm` and `-wal` removed; without the fallback the block is silently empty exactly when the session most needs it.
- Schema drift in `working_memory` breaking the queries → the queries name only long-stable columns and select explicit names rather than `*`; a missing column raises and fails open to no block.
- Direct writes bypassing Mnemosyne's own invariants → writes are confined to four metadata columns on one row by primary key, never to `content` or to any vector table, so nothing that Mnemosyne derives from content can fall out of step.
- An oversized standing block crowding the context → three bounds apply: the importance floor governs which global rows qualify, the per-entry cap holds each project index entry to a pointer, and the whole-block budget truncates the tail once the qualifying set outgrows the floor.
- An agent that never calls recall, leaving memory unread beyond the block → the block names the tool and the project index points at the topic sources, which is the same contract the shell hook has run under; if agents prove not to call it, the answer is a stronger pointer in the block, not a return to per-turn injection.
- `list` returning hundreds of rows in a mature project → the default view is the promotion candidates, the sub-floor session-turn rows, capped at twenty and most recent first; `--all` and `--limit` widen it.
- Node 24 floor stranding a Pi user on 22.19 → the floor is documented in the requirements, and `MNEMOSYNE_MEMORY_RECALL=0` leaves the package working as it does today on the older runtime.

## Migration Plan

Automatic recall is already off by default, so the token cost stops before this change ships and installations keep working with retention alone. This change removes the disabled path, adds the standing block, and defaults it on; existing installations gain the block on their next session with no configuration change.

Pi users configure `pi-mcp-adapter` so the agent has a recall tool, and move to Node 24. Rollback is `MNEMOSYNE_MEMORY_RECALL=0`, which leaves retention running and every retrieval in the agent's hands.
