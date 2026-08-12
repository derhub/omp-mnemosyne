## Context

See `proposal.md` for motivation and `specs/memory-observability/spec.md` for observable behavior. This repository contains a Bun package for agent recall and retention integrations, not the Mnemosyne server. Existing entrypoints call `mnemosyne mcp` over stdio and intentionally reduce recall results to content-only values. The dashboard needs rich read responses without changing those paths.

The installed Mnemosyne 3.15.1 MCP surface does not provide a stable, versioned statistics contract for every promised overview metric. The dashboard therefore has a hard external prerequisite in `AxDSan/mnemosyne`: an official release must stabilize `mnemosyne_stats`, include a statistics schema version and server version, and define physical and recallable memory/session counts. No dashboard implementation starts before that release.

Mnemosyne is local, its browser-incompatible transport is stdio, and its bank depends on forwarded `MNEMOSYNE_*` and `HERMES_HOME` environment variables. The browser must not receive database access or mutation tools.

## Goals / Non-Goals

**Goals:**

- Answer whether the inherited Mnemosyne bank is reachable and compatible within five seconds of opening the app.
- Isolate a React web runtime and dependencies under `apps/web`.
- Keep route, input, and response types explicit across the browser/server boundary.
- Use the same bank selection rules as the existing integrations.
- Establish one validated app-scoped visual source of truth before composing UI.
- Keep optional-source failures visible without hiding compatible statistics.

**Non-Goals:**

- Starting dashboard implementation before the official prerequisite server release.
- Corpus browsing, source aggregation, or TTL distribution.
- Memory mutation, hygiene cleanup, persona management, triples, export, or sync control.
- Runtime bank switching, remote hosting, authentication, multi-user access, or direct SQLite reads.
- Legacy statistics adapters or package-version-only compatibility checks.
- Adding TanStack Query before shared cache behavior or polling exists.
- Using a non-React frontend framework.

## Decisions

### Gate implementation on a versioned upstream statistics schema

The prerequisite release will extend the general-purpose `mnemosyne_stats` tool rather than add a dashboard-specific endpoint. Its response contract must include:

- `schema_version` for compatibility gating
- server version
- logical bank name, database filename, and resolved path
- physical and recallable memory counts
- physical and recallable distinct session counts
- separately identified BEAM tier counts

Recallable means non-superseded and not expired at query time. Session counts use distinct session identifiers in the corresponding physical or recallable set. The dashboard gates on the statistics schema version, reports the server version for remediation, and rejects legacy or malformed payloads. The exact supported schema version is recorded after the official release and before implementation begins.

Waiting for upstream avoids a private SQLite dependency, temporary fork, provisional mock contract, and permanent legacy adapter.

### Use an isolated React and TanStack Start application

`apps/web` will be a React application and Bun workspace package built with TanStack Start. Start supplies TanStack Router's file-based route contract plus server functions in one React application. A Router-only Vite SPA cannot spawn MCP stdio. A separate Bun API server duplicates contracts and lifecycle.

The route tree is deliberately small:

```text
/          health-first overview
/recall    ephemeral recall probe
```

A separate `/health` route was removed because it duplicated the overview. A compact responsive top navigation is sufficient for two routes; a sidebar adds unnecessary state and mobile behavior.

### Keep Mnemosyne access server-only and read-only

A server-only adapter will spawn `mnemosyne mcp` with the existing forwarded environment policy, call only `mnemosyne_stats`, `mnemosyne_sync_status`, and `mnemosyne_recall`, parse MCP text payloads into narrow typed responses, and close transports in `finally`. Every operation has a five-second timeout.

The first implementation uses request-scoped clients. Browser verification measures 20 warm overview and recall requests. If either p95 exceeds one second, the implementation switches to one process-scoped client with reconnect-on-failure before delivery. This preserves the simpler lifecycle unless actual latency rejects it.

The existing content-only parser remains unchanged. Rich dashboard parsing belongs to the web adapter because automatic prompt injection intentionally has a smaller contract.

### Enforce a localhost browser boundary

The supported server command hard-binds to loopback with no host override. Server middleware accepts only loopback Host values, rejects foreign Origin values before invoking MCP, and emits no permissive CORS headers. Recall uses POST server functions. The browser never receives MCP credentials, database handles, or mutation calls.

The dashboard inherits one bank from its process environment. Changing banks requires a restart. The overview shows the logical bank name and database filename; the full resolved path remains behind an explicit reveal or copy action to reduce screenshot leakage.

### Treat health as a connectivity contract

The overview derives one headline state:

- healthy: MCP and the required statistics schema respond; no configured optional source fails
- degraded: required checks pass, but configured sync status fails
- unavailable: MCP connection or statistics compatibility fails

An unconfigured sync source is factual state, not degradation. Zero memories is displayed but does not imply an unhealthy service. Stored-memory and BEAM counts remain separate and are never summed.

Statistics and sync status resolve independently so a sync failure does not hide bank metrics. Overview data refreshes on route navigation and window focus, with its last successful refresh time visible. Focus never reruns a recall probe.

### Keep recall diagnostic state ephemeral

Recall accepts a trimmed prompt and integer limit from 1 through 20, default 5, through POST. Prompt, results, expansion state, and explanation trace live only in React route memory and never enter URLs, persistent browser storage, or logs. Starting a new request clears old results.

Results appear ranked with metadata and line-clamped previews. Full content requires explicit per-result expansion. An off-by-default explanation toggle passes `explain: true` when selected and renders the structured response as a request-level trace panel, not a raw JSON dump. Ranking weights remain server defaults; the first release is diagnostic, not a tuning laboratory.

### Use a validated technical-instrument visual system

The product title is `Memory Console`. shadcn/ui initializes with the Base Nova preset and adds only React components used by the two routes. Route code composes app-owned components directly; no wrapper component layer is added.

`apps/web/DESIGN.md` follows the `google-labs-code/design.md` format. It defines:

- technical-instrument direction with signal cyan as the interaction accent
- system sans and monospace stacks; no bundled or remote fonts
- light and dark palettes selected from the OS preference, with no persisted manual switch
- semantic status tokens distinct from the cyan interaction accent
- compact desktop density that reflows fully through phone widths
- visible focus and reduced-motion behavior

Its tokens map to shadcn/Tailwind semantic CSS variables. `@google/design.md` is a web development dependency, and `bun run design:lint` invokes `designmd lint DESIGN.md` as part of web verification.

### Add only a minimal Bun workspace boundary

The root package declares `apps/*` as workspaces and exposes convenience scripts for web development and verification. `apps/web/package.json` owns React, TanStack Start/Router, Tailwind, shadcn/ui, the MCP client, and design validation dependencies. Existing root entrypoints and checks remain unchanged. One app does not justify a task runner.

## Risks / Trade-offs

- [Upstream release is delayed] -> Keep this change planning-only; do not add mocks, a fork, or direct database access.
- [Statistics schema changes after release] -> Gate on `schema_version`, parse at the server boundary, and block incompatible servers with an actionable error.
- [Request-scoped MCP startup is slow] -> Enforce the one-second warm p95 gate and switch to a reconnecting process-scoped client only when measured.
- [Recall content leaks through browser state] -> Use POST, memory-only state, collapsed previews, no logging, and no persistence.
- [A malicious page targets localhost] -> Enforce loopback Host and Origin checks and no permissive CORS.
- [Aggregate APIs cannot support corpus analytics] -> Keep the dashboard health- and recall-focused until supported inventory APIs exist.
- [Light and dark tokens drift from rendered CSS] -> Map semantic CSS variables from `DESIGN.md`, run design lint, and visually verify both OS modes.
- [Fully responsive density harms readability] -> Stack metrics and trace sections at narrow widths rather than shrinking typography or introducing horizontal page scrolling.

## Migration Plan

1. Land and release the prerequisite `mnemosyne_stats` schema upstream.
2. Record the released schema and minimum server versions in this change before implementation starts.
3. Add the Bun workspace boundary without changing existing package entrypoints.
4. Create the React app in `apps/web`, `DESIGN.md`, and independent verification scripts.
5. Add the server-only MCP adapter, security middleware, and two routes.
6. Exercise the app against an isolated bank, enforce the latency gate, and document local startup and bank selection.

Rollback removes `apps/web`, its workspace scripts, and the workspace entry. Existing recall and retention integrations remain unchanged throughout.
