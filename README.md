# Mnemosyne Memory for Coding Agents

Automatic recall and retention for [Oh My Pi](https://github.com/can1357/oh-my-pi), [Pi](https://pi.dev), Codex, Claude Code, and AGY through a local Mnemosyne MCP server.

## Requirements

- OMP 17.2.12 or later, Pi 0.84.1 or later, Codex CLI, Claude Code, or AGY.
- Mnemosyne 3.15.1 or later on `PATH`.
- Node.js 22.19 or later for Pi.
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

Pi starts its own `mnemosyne mcp` stdio client for automatic recall and retention. Configure the same server through `pi-mcp-adapter` only if you also want Pi's explicit `mcp__mnemosyne_*` tools. Restart Pi after changing its settings.

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

Codex recalls on `UserPromptSubmit` and retains the completed response on `Stop`.

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

Claude Code recalls on `UserPromptSubmit` and retains the completed response from its `Stop` event's `last_assistant_message` field.

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

AGY recalls before every model invocation and retains only a `model_stop` execution that reports `fullyIdle: true`.

## Behavior

- Before each substantive prompt, recalls up to five memories using the first 4,000 prompt characters.
- Skips prompts under 16 characters and prompts opening with a host slash-command, so acknowledgements ("g", "yes, do it") and `/commit` cost neither a recall nor a stored turn.
- Limits each injected memory to 2,000 characters and XML-escapes it before adding it as untrusted background context.
- After each settled main-session turn, stores the latest real user text and final assistant text, limited to 8,000 characters each.
- Stores turns at session scope as `projects/<project>/<host>-session.md`, importance 0.25, expiring after 14 days, with host session and turn IDs as metadata.
- Fails open. A missing server, transport error, malformed result, or five-second timeout leaves the host turn usable.

`<project>` is the `origin` remote's repository name, falling back to the main worktree's directory name and then the working directory. Linked worktrees resolve to the parent repository, so a repo keeps one namespace.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `MNEMOSYNE_MEMORY_RETAIN` | `1` | `0` runs recall-only; nothing is written. |
| `MNEMOSYNE_MEMORY_RECALL_LIMIT` | `5` | Memories injected per prompt. |
| `MNEMOSYNE_MEMORY_MIN_PROMPT` | `16` | Minimum prompt length worth a round trip; `0` disables the gate. |
| `MNEMOSYNE_MEMORY_IMPORTANCE` | `0.25` | Importance of stored turns. |
| `MNEMOSYNE_MEMORY_SOURCE` | `projects/<project>/<host>-session.md` | Source tag of stored turns. |
| `MNEMOSYNE_MEMORY_SCOPE` | `session` | `global` shares turns across every project. |
| `MNEMOSYNE_MEMORY_TTL_DAYS` | `14` | Retention window; `0` stores turns without an expiry. |

Low importance and the expiry window keep a transcript stream from outranking hand-curated memories in recall: importance is a scored term in hybrid ranking, and the recall path drops rows whose `valid_until` has passed. Session scope does *not* narrow recall — recall filters on `superseded_by` and `valid_until` only — but it does keep stored turns out of any query selecting `scope = 'global'`, which is how session-start injections usually select their always-on rows. A bank whose curated rows are the authority is best served by `MNEMOSYNE_MEMORY_RETAIN=0` plus explicit `mnemosyne_remember` calls.

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
