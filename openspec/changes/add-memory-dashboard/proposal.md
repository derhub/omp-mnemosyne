## Why

Mnemosyne exposes memory state through command and MCP interfaces, but operators lack a focused way to answer whether the active memory system is healthy and why a recall ranked its results. A local read-only Memory Console provides that visibility after Mnemosyne publishes a stable statistics schema for the required metrics.

## What Changes

- Add a fully responsive React application under `apps/web` using TanStack Start, TanStack Router, and shadcn/ui with the Base Nova preset.
- Add an app-scoped `apps/web/DESIGN.md` following the `google-labs-code/design.md` format, with a technical-instrument visual system validated as part of the web verification path.
- Show connectivity health, compatible server and statistics schema versions, active bank identity, physical and recallable memory/session counts, separately labeled BEAM tier counts, sync state, and refresh time.
- Add an ephemeral recall probe with ranked results, collapsed content previews, a result limit from 1 to 20, and an optional request-level explanation trace.
- Keep all dashboard operations read-only; route browser requests through a loopback-only local server boundary with Host and Origin checks to Mnemosyne MCP over stdio.
- Refresh overview data on navigation and window focus without automatically repeating recall probes.

## Capabilities

### New Capabilities

- `memory-observability`: Read-only local inspection of Mnemosyne bank health, aggregate memory metrics, and recall results.

### Modified Capabilities

None.

## Impact

- Adds the `apps/web` Bun workspace package and its frontend dependencies.
- Adds `@google/design.md` as a web development dependency for design-system validation.
- Depends on an official Mnemosyne release that stabilizes `mnemosyne_stats`, exposes an explicit statistics schema version, and defines physical and recallable memory/session counts.
- Blocks dashboard implementation until that upstream release exists; legacy statistics responses are not adapted.
- Adds a server-side, read-only Mnemosyne MCP client without changing the existing automatic recall and retention integrations.
