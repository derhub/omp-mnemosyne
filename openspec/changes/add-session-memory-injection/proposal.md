## Why

Automatic memory runs on the wrong schedule. Every qualifying turn spends a recall round trip and up to five memories of two thousand characters each, chosen by how well they rank against that turn's prompt. In the command hosts the result is a transcript entry, so the cost compounds: a twenty-turn session carries twenty recall blocks. What that buys is a guess at relevance the agent could have made itself, and it arrives whether or not the turn needed memory at all.

What no path delivers is the memory a session needs before it knows what it is about — the user's standing rules and the current project's index. Those are needed once, at the start, regardless of what the first prompt says. A session that opens with "fix the build" begins with no project context and no binding conventions, having already paid for five memories that matched the word "build".

Promotion and permanence have a separate gap. A memory earns global reach when its pattern recurs outside one repository, and a project memory becomes load-bearing when it belongs in that project's index. Both are metadata transitions on an existing row, and neither has an interface.

## What Changes

- Inject a session recall block once per session in all five hosts, composed of global rows at or above an importance floor plus named index sources, and the current project's index.
- Deliver the block through each host's conversation channel, so it persists for the session without redelivery.
- **BREAKING**: stop the automatic per-turn recall. Memory retrieval becomes the agent's call through the `mnemosyne_recall` tool, which the standing block points it to.
- Keep retention: settled turns still store to the project namespace, so the bank the agent recalls from keeps filling.
- Read the bank through a runtime-dispatched SQLite driver rather than the MCP server, because `mnemosyne_recall` exposes no scope, source, or importance filter.
- Add a `memory.ts` command interface with `list`, `promote`, and `pin` for inspecting and transitioning memory rows.
- **BREAKING**: raise the Pi runtime floor from Node 22.19 to Node 24, where `node:sqlite` is stable and unflagged.

## Capabilities

### New Capabilities

- `session-memory-injection`: Once-per-session delivery of global standing rules and the current project's memory index, across every supported host, as the only automatic memory injection.
- `memory-promotion`: Command-line transitions that widen a project memory to global scope and that make a memory permanent in its project index.

### Modified Capabilities

None.

## Impact

- Removes the recall path from `hooks.ts`, `index.ts`, and `pi.ts`, and the recall block builder and response parser it used.
- Adds a bank read module, a standing block builder, and a `memory.ts` command entrypoint.
- Adds configuration for the importance floor, index source names, per-entry cap, block budget, and the injection toggle.
- Requires the `mnemosyne` MCP server to be reachable by the host for agent-triggered recall; the extensions register no tools of their own.
- Raises the documented Node requirement and adds the runtime-dispatched driver to the dependency surface.
- Grants write access to the bank for the first time, confined to the transition commands.
