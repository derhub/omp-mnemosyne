# Mnemosyne Memory for OMP and Pi

Automatic recall and retention for [Oh My Pi](https://github.com/can1357/oh-my-pi) and [Pi](https://pi.dev) through a local Mnemosyne MCP server.

## Requirements

- OMP 17.2.12 or later, or Pi 0.84.1 or later.
- Mnemosyne 3.15.1 or later on `PATH`.
- Node.js 22.19 or later for Pi.
- Bun for tests.

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
npm install --omit=dev
```

```sh
pi install /path/to/mnemosyne-memory
```

For development, load the extension directly:

```sh
pi -e /path/to/mnemosyne-memory/pi.ts
```

Pi starts its own `mnemosyne mcp` stdio client for automatic recall and retention. Configure the same server through `pi-mcp-adapter` only if you also want Pi's explicit `mcp__mnemosyne_*` tools. Restart Pi after changing its settings.

## Behavior

- Before each non-empty prompt, recalls up to eight global memories using the first 4,000 prompt characters.
- Limits each injected memory to 2,000 characters and XML-escapes it before adding it as untrusted background context.
- After each settled main-session turn, stores the latest real user text and final assistant text, limited to 8,000 characters each.
- Stores records globally as `omp-session` or `pi-session`, with host session and turn IDs as metadata.
- Fails open. A missing server, transport error, malformed result, or five-second timeout leaves the host turn usable and logs one warning until the operation succeeds.

Global retention makes stored interactions available to every OMP and Pi project sharing the Mnemosyne data directory. Do not submit content you do not want persisted.

`memory.backend: off` intentionally disables OMP-native `/memory`, `ctx.memory`, `memory://`, `recall`, and `retain`. The OMP extension adds no duplicate MCP tools or `/memory` command.

Use OMP's existing `mcp__mnemosyne_remember`, `mcp__mnemosyne_recall`, `mcp__mnemosyne_get`, `mcp__mnemosyne_stats`, and `mcp__mnemosyne_forget` tools for explicit memory operations. In Pi, configure Mnemosyne with `pi-mcp-adapter` when you need its explicit MCP tools.

## Test

```sh
bun test core.test.ts
npm run typecheck:pi
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
