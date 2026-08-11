# Mnemosyne Memory for OMP

Automatic recall and retention for [Oh My Pi](https://github.com/can1357/oh-my-pi) through its configured Mnemosyne MCP server.

## Requirements

- OMP 17.2.12 or later.
- Mnemosyne 3.15.1 or later.
- A stdio MCP server named `mnemosyne`.
- Bun for tests.

## Install

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

## Behavior

- Before each non-empty prompt, recalls up to eight global memories using the first 4,000 prompt characters.
- Limits each injected memory to 2,000 characters and XML-escapes it before adding it as untrusted background context.
- After each main-session turn, stores the latest real user text and final assistant text, limited to 8,000 characters each.
- Stores records globally as `omp-session`, with OMP session and turn IDs as metadata.
- Fails open. A missing server, transport error, malformed result, or five-second timeout leaves the OMP turn usable and logs one warning until the operation succeeds.

Global retention makes stored interactions available to every OMP project sharing the Mnemosyne data directory. Do not submit content you do not want persisted.

`memory.backend: off` intentionally disables OMP-native `/memory`, `ctx.memory`, `memory://`, `recall`, and `retain`. This extension adds no duplicate MCP tools or `/memory` command.

Use OMP's existing `mcp__mnemosyne_remember`, `mcp__mnemosyne_recall`, `mcp__mnemosyne_get`, `mcp__mnemosyne_stats`, and `mcp__mnemosyne_forget` tools for explicit memory operations.

## Test

```sh
bun test core.test.ts
```

## Troubleshooting

```sh
mnemosyne stats
mnemosyne doctor --format json
```

## Rollback

Remove the extension entry, restore the prior `memory.backend` value, and start a new OMP session.

## License

MIT. See [LICENSE](LICENSE).
