## 1. Configuration

- [x] 1.1 Add `recallEnabled`, `recallFloor` (default `0.95`), `recallIndexes`, `recallCap` (default `280`), and `recallBudget` (default `12000`) readers to `config.ts`, following the existing `envText`/`envNumber` pattern
- [x] 1.2 Add `bankPath()` to `config.ts`, resolving `${MNEMOSYNE_DATA_DIR:-~/.memories}/mnemosyne.db`
- [x] 1.3 Cover the new readers in `config.test.ts`, including defaults, overrides, and a malformed floor falling back

## 2. Bank reader

- [x] 2.1 Create `bank.ts` with a driver adapter selecting `bun:sqlite` or `node:sqlite` on `process.versions.bun`, opening read-only
- [x] 2.2 Add a live-row predicate covering `superseded_by`, `consolidated_at`, and `valid_until`
- [x] 2.3 Add `readGlobalRules(floor, indexes)` returning content ordered by importance then timestamp
- [x] 2.4 Add `readProjectIndex(project)` returning content for source `projects/<project>/MEMORY.md`, most recent first
- [x] 2.5 Make every read fail closed to an empty result on a missing file, an open error, or a query error
- [x] 2.6 Cover the reader in `bank.test.ts` against a temporary bank: floor boundary, index-source inclusion below the floor, each exclusion column, ordering, and a missing file

## 3. Block builder

- [x] 3.1 Add `renderRecallBlock(rules, index, project, options)` to `core.ts`, reusing the existing escape and truncation helpers
- [x] 3.2 Emit the untrusted-context preamble, the global rules section, and the project index section
- [x] 3.3 Emit the closing pointer naming `mnemosyne_recall` as the way to reach memory the block does not carry
- [x] 3.4 Emit the empty-project line naming the project and its index source when the index is empty
- [x] 3.5 Apply the per-entry cap to project index entries and the whole-block budget across both sections, reporting the number withheld
- [x] 3.6 Return nothing when both sections are empty
- [x] 3.7 Cover the builder in `core.test.ts`: escaping, per-entry truncation, budget truncation with the withheld count, empty project, and both sections empty

## 4. Retire the recall path

- [x] 4.1 Remove the `recall` operation and its call sites from `hooks.ts`, `index.ts`, and `pi.ts`
- [x] 4.2 Remove `renderMemoryBlock` and `parseRecallResponse` from `core.ts`, and `recallEnabled` and `recallLimit` from `config.ts`
- [x] 4.3 Keep `savePending` on the command hosts' prompt event, which retention depends on
- [x] 4.4 Drop the recall assertions and the `MNEMOSYNE_MEMORY_RECALL` fixtures from all four test files
- [x] 4.5 Confirm retention still stores a settled turn in every host after the removal

## 5. Extension hosts

- [x] 5.1 In `index.ts`, deliver the block on the first `before_agent_start` of a session as `message` with `customType: "mnemosyne-memory"` and `display: false`
- [x] 5.2 Register `session_start` in `index.ts` to clear the recalled flag, so a new, resumed, or forked session recalls again
- [x] 5.3 Apply both changes to `pi.ts`
- [x] 5.4 Skip recall when `recallEnabled` is false
- [x] 5.5 Cover both hosts: delivered on first turn, absent on second, delivered again after `session_start`, delivered when the prompt fails the prompt gates, absent when disabled

## 6. Command hosts

- [x] 6.1 In `hooks.ts`, add a per-session recall marker file, claimed with an exclusive create in the state directory, keyed by host and session
- [x] 6.2 Deliver the block from the prompt event before the prompt gates, writing the marker on first delivery
- [x] 6.3 Return it as `additionalContext` for Claude and Codex, and as `ephemeralMessage` for AGY
- [x] 6.4 Cover in `hooks.test.ts`: first prompt delivers, second does not, a sub-minimum prompt delivers, a slash-command prompt delivers, and disabled delivers nothing

## 7. Transition commands

- [ ] 7.1 Create `memory.ts` with a `list|promote|pin` argument parser and a usage message on an unknown verb
- [ ] 7.2 Add a read-write bank open to `bank.ts`, kept separate from the read-only path
- [ ] 7.3 Implement `list`, defaulting to the project's live sub-floor rows most recent first under `--limit` (default 20), with `--all` for the full namespace, reporting the number withheld
- [ ] 7.4 Implement `promote <id> <source>`, setting scope to global, source to the argument, and importance to a fixed promoted constant; reject a missing source argument
- [ ] 7.5 Implement `pin <id>`, clearing `valid_until`, setting source to the current project's index, and setting `pinned = 1`
- [ ] 7.6 Report before and after state for each transition, and reject an unknown identifier without writing
- [ ] 7.7 Cover in `memory.test.ts` against a temporary bank: each verb, the default and `--all` listings, the limit and its withheld count, the unknown identifier, the missing promote source, and that `content` and `id` survive both transitions

## 8. Documentation and verification

- [x] 8.1 Rewrite the Behavior section of `README.md` around session recall and agent-triggered retrieval
- [x] 8.2 Replace the per-turn recall rows in the configuration table with the session recall rows
- [ ] 8.3 Document `memory.ts list|promote|pin` with the promotion and permanence workflow
- [x] 8.4 Document that each host needs the `mnemosyne` MCP server reachable for the agent to recall, and that Pi needs `pi-mcp-adapter`
- [x] 8.5 Raise the documented Node requirement to 24 and note `MNEMOSYNE_MEMORY_RECALL=0` as the fallback for older runtimes
- [ ] 8.6 Add `bank.ts` and `memory.ts` to the `typecheck` script's file list
- [x] 8.7 Run `bun test` and `bun run typecheck`
