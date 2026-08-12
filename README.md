# Mnemosyne Memory for Coding Agents

Automatic recall and retention for [Oh My Pi](https://github.com/can1357/oh-my-pi), [Pi](https://pi.dev), Codex, Claude Code, and AGY through a local Mnemosyne MCP server.

## Requirements

- OMP 17.2.12 or later, Pi 0.84.1 or later, Codex CLI, Claude Code, or AGY.
- Mnemosyne 3.15.1 or later on `PATH`.
- Node.js 24 or later for Pi, where `node:sqlite` is stable and unflagged.
- Bun for command hooks and tests.

## Install

### OMP

Copy this directory to a stable local path outside OMP's auto-discovered `extensions/` root. Add its `index.ts` path to OMP's user configuration:

```yaml
memory:
  backend: off
extensions:
  - /path/to/mnemosyne-memory/index.ts
```

Configure the `mnemosyne` MCP server in OMP if it is not already available:

```json
{
  "mcpServers": {
    "mnemosyne": {
      "command": "mnemosyne",
      "args": ["mcp"]
    }
  }
}
```

Start a new OMP session after changing its configuration.

### Pi

Install the package locally, then register it with Pi:

```sh
cd /path/to/mnemosyne-memory
bun install --production
```

```sh
pi install /path/to/mnemosyne-memory
```

For development, load the extension directly:

```sh
pi -e /path/to/mnemosyne-memory/pi.ts
```

Pi starts its own `mnemosyne mcp` stdio client for retention. Configure the same server through `pi-mcp-adapter` so the agent has the `mcp__mnemosyne_*` tools it needs to recall on its own. Restart Pi after changing its settings.

### Codex

Merge the following into `~/.codex/hooks.json` or `.codex/hooks.json`, replacing `/path/to/mnemosyne-memory` with this package's absolute path:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "bun /path/to/mnemosyne-memory/hooks.ts codex",
        "timeout": 10,
        "additionalContextLimit": 16000
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "bun /path/to/mnemosyne-memory/hooks.ts codex",
        "timeout": 10
      }]
    }]
  }
}
```

Codex retains the completed response on `Stop`. The `UserPromptSubmit` hook records the prompt for that retention, and recalls once on the session's first prompt.

### Claude Code

Merge the following into `~/.claude/settings.json` or `.claude/settings.json`, replacing `/path/to/mnemosyne-memory` with this package's absolute path:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "bun /path/to/mnemosyne-memory/hooks.ts claude",
        "timeout": 10
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "bun /path/to/mnemosyne-memory/hooks.ts claude",
        "timeout": 10
      }]
    }]
  }
}
```

Claude Code retains the completed response from its `Stop` event's `last_assistant_message` field. The `UserPromptSubmit` hook records the prompt for that retention, and recalls once on the session's first prompt.

### AGY

AGY support is experimental because its hooks do not expose the current user prompt or final assistant response. The hook reads AGY's undocumented JSONL transcript and may need updating for future AGY releases.

Merge the following into `.agents/hooks.json` or `~/.gemini/config/hooks.json`, replacing `/path/to/mnemosyne-memory` with this package's absolute path:

```json
{
  "mnemosyne-memory": {
    "PreInvocation": [{
      "type": "command",
      "command": "bun /path/to/mnemosyne-memory/hooks.ts agy PreInvocation",
      "timeout": 10
    }],
    "Stop": [{
      "type": "command",
      "command": "bun /path/to/mnemosyne-memory/hooks.ts agy Stop",
      "timeout": 10
    }]
  }
}
```

AGY retains only a `model_stop` execution that reports `fullyIdle: true`. The `PreInvocation` hook recalls once on the session's first invocation.

## Behavior

- Recalls once, on the session's first agent turn: every live global memory at or above the importance floor, every live global memory whose source names a configured index, and the current project's index. XML-escaped, labelled untrusted background context, and never repeated for the rest of the session.
- Leaves every further retrieval to the agent through `mnemosyne_recall`, which the block names. Nothing is recalled per turn.
- Recalls regardless of the prompt, so a session opened with "g" or `/commit` still starts with its standing rules and project index.
- Bounds the block three ways: the floor governs which global rows qualify, a per-entry cap holds each project index entry to a pointer, and a whole-block budget truncates the tail and reports how many memories it withheld.
- Excludes any memory that is superseded, consolidated away, or past its `valid_until`.
- Skips prompts under 16 characters and prompts opening with a host slash-command for retention, so acknowledgements and `/commit` cost no stored turn.
- After each settled main-session turn, stores the latest real user text and final assistant text, limited to 8,000 characters each.
- Stores turns at session scope as `projects/<project>/<host>-session.md`, importance 0.25, expiring after 14 days, with host session and turn IDs as metadata.
- Fails open. A missing bank, missing server, transport error, malformed result, or five-second timeout leaves the host turn usable.

`<project>` is the `origin` remote's repository name, falling back to the main worktree's directory name and then the working directory. Linked worktrees resolve to the parent repository, so a repo keeps one namespace. The project index is `projects/<project>/MEMORY.md`, the same namespace retention writes under.

Each host needs the `mnemosyne` MCP server reachable for the agent to recall on its own. Session recall itself reads the bank directly and needs no server.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `MNEMOSYNE_MEMORY_RETAIN` | `1` | `0` writes nothing. |
| `MNEMOSYNE_MEMORY_RECALL` | `1` | `0` disables session recall; retention is unaffected. |
| `MNEMOSYNE_MEMORY_RECALL_FLOOR` | `0.95` | Importance at or above which a global memory joins the block. |
| `MNEMOSYNE_MEMORY_RECALL_INDEXES` | `MEMORY.md,FEEDBACK.md` | Global sources that join the block regardless of importance. |
| `MNEMOSYNE_MEMORY_RECALL_CAP` | `280` | Per-entry character cap on project index entries. |
| `MNEMOSYNE_MEMORY_RECALL_BUDGET` | `12000` | Character cap on the whole block. |
| `MNEMOSYNE_MEMORY_MIN_PROMPT` | `16` | Minimum prompt length worth retaining; `0` disables the gate. |
| `MNEMOSYNE_MEMORY_IMPORTANCE` | `0.25` | Importance of stored turns. |
| `MNEMOSYNE_MEMORY_SOURCE` | `projects/<project>/<host>-session.md` | Source tag of stored turns. |
| `MNEMOSYNE_MEMORY_SCOPE` | `session` | `global` shares turns across every project. |
| `MNEMOSYNE_MEMORY_TTL_DAYS` | `14` | Retention window; `0` stores turns without an expiry. |

Indexes join the block below the floor because they are the pointers that make recall-on-demand possible; a floor high enough to hold rule bodies out would hold them out too. The floor is the knob for block size, and the budget is the backstop: a floor governs which rows qualify, not how many, so a bank that accumulates high-importance rows outgrows any floor.

Low importance and the expiry window keep a transcript stream from outranking hand-curated memories: importance is a scored term in hybrid ranking, and both session recall and `mnemosyne_recall` drop rows whose `valid_until` has passed. Session scope also keeps stored turns out of the `scope = 'global'` half of the block. A bank whose curated rows are the authority is best served by `MNEMOSYNE_MEMORY_RETAIN=0` plus explicit `mnemosyne_remember` calls.

### Bank selection

The command hooks and the Pi extension spawn `mnemosyne mcp` over stdio. That transport passes only an allowlisted environment to the child, which omits every `MNEMOSYNE_*` variable — an unforwarded server resolves its data directory from its own defaults rather than the one the `mnemosyne` CLI uses, then reads and writes a bank nothing else sees. Both entrypoints therefore forward `MNEMOSYNE_*` and `HERMES_HOME` explicitly.

Confirm every agent agrees on one bank before trusting retention:

```sh
mnemosyne stats            # the DB path the CLI resolves
```

Export `MNEMOSYNE_DATA_DIR` in the environment that launches the host when that path is not the bank you intend to use. Under OMP the server is the one configured in OMP's `mcpServers`, so its environment is OMP's to set.

Command hooks retain their active prompt temporarily under `$MNEMOSYNE_MEMORY_STATE_DIR`, or `~/.local/state/mnemosyne-memory` by default. Stored interactions are readable by every agent sharing the Mnemosyne data directory. Do not submit content you do not want persisted.

`memory.backend: off` intentionally disables OMP-native `/memory`, `ctx.memory`, `memory://`, `recall`, and `retain`. The OMP extension adds no duplicate MCP tools or `/memory` command.

Use OMP's existing `mcp__mnemosyne_remember`, `mcp__mnemosyne_recall`, `mcp__mnemosyne_get`, `mcp__mnemosyne_stats`, and `mcp__mnemosyne_forget` tools for explicit memory operations. In Pi, configure Mnemosyne with `pi-mcp-adapter` when you need its explicit MCP tools.

## Test

```sh
bun test
bun run typecheck
```

`integration.test.ts` drives a real `mnemosyne mcp` server end to end and is skipped when the binary is absent. It points `MNEMOSYNE_DATA_DIR` at a temporary directory, so it never touches a real bank.

## Troubleshooting

```sh
mnemosyne stats
mnemosyne doctor --format json
```

## Rollback

Remove the OMP or Pi extension entry, or the host hook entries, then restart the host. Delete `$MNEMOSYNE_MEMORY_STATE_DIR` if you also want to remove pending local prompts.

## License

MIT. See [LICENSE](LICENSE).
