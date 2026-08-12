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

- Before each non-empty prompt, recalls up to eight global memories using the first 4,000 prompt characters.
- Limits each injected memory to 2,000 characters and XML-escapes it before adding it as untrusted background context.
- After each settled main-session turn, stores the latest real user text and final assistant text, limited to 8,000 characters each.
- Stores records globally as `<host>-session`, with host session and turn IDs as metadata.
- Fails open. A missing server, transport error, malformed result, or five-second timeout leaves the host turn usable.

Command hooks retain their active prompt temporarily under `$MNEMOSYNE_MEMORY_STATE_DIR`, or `~/.local/state/mnemosyne-memory` by default. Global retention makes stored interactions available to every configured agent and project sharing the Mnemosyne data directory. Do not submit content you do not want persisted.

`memory.backend: off` intentionally disables OMP-native `/memory`, `ctx.memory`, `memory://`, `recall`, and `retain`. The OMP extension adds no duplicate MCP tools or `/memory` command.

Use OMP's existing `mcp__mnemosyne_remember`, `mcp__mnemosyne_recall`, `mcp__mnemosyne_get`, `mcp__mnemosyne_stats`, and `mcp__mnemosyne_forget` tools for explicit memory operations. In Pi, configure Mnemosyne with `pi-mcp-adapter` when you need its explicit MCP tools.

## Test

```sh
bun test
bun run typecheck
```

## Troubleshooting

```sh
mnemosyne stats
mnemosyne doctor --format json
```

## Rollback

Remove the OMP or Pi extension entry, or the host hook entries, then restart the host. Delete `$MNEMOSYNE_MEMORY_STATE_DIR` if you also want to remove pending local prompts.

## License

MIT. See [LICENSE](LICENSE).
