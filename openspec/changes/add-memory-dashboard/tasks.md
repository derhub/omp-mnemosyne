## 1. Upstream Release Gate

- [ ] 1.1 Confirm an official `AxDSan/mnemosyne` release exposes the required `mnemosyne_stats` schema version, server version, bank identity, physical and recallable memory/session counts, separately identified BEAM tiers, and guaranteed structured `mnemosyne_recall` explanation output; record the supported statistics schema and minimum server versions in the design before starting any dashboard implementation.

## 2. React Web Foundation

- [ ] 2.1 Configure the Bun `apps/*` workspace and scaffold the React TanStack Start application in `apps/web` without changing existing root package entrypoints or checks.
- [ ] 2.2 Initialize shadcn/ui with Base Nova and add only the components required for compact top navigation, overview metrics, recall input, collapsed results, structured trace, loading, empty, and error states.
- [ ] 2.3 Create `apps/web/DESIGN.md` with technical-instrument light/dark tokens, signal-cyan interaction accents, system typography, responsive rules, and accessibility guidance; map it to semantic app CSS and add `bun run design:lint`.

## 3. Read-Only Mnemosyne Boundary

- [ ] 3.1 Implement request-scoped, server-only MCP calls for compatible statistics, independent sync status, and POST recall with version-gated structured explanation parsing, forwarded bank environment, five-second timeouts, runtime response validation, and guaranteed transport closure.
- [ ] 3.2 Enforce loopback-only startup, loopback Host validation, foreign Origin rejection, and no permissive CORS before any MCP invocation.
- [ ] 3.3 Add focused server tests for compatibility gating, physical versus recallable counts, partial sync failure, malformed responses, timeout, Host/Origin rejection, recall limits 1 through 20, explanation mode, and stale-result clearing.

## 4. Memory Console Experience

- [ ] 4.1 Build the fully responsive React shell and `/` overview with compact top navigation, connectivity health, exact source-specific metric labels, concealed full bank path, partial-source states, last refresh time, and overview refresh on navigation or focus.
- [ ] 4.2 Build `/recall` with ephemeral POST state, default limit 5, collapsed ranked previews, explicit full-content expansion, an off-by-default explanation toggle, a structured request trace panel, and loading, empty, and non-stale error states.
- [ ] 4.3 Document local startup, inherited bank selection, security boundary, supported server/schema versions, count semantics, and read-only aggregate limits.

## 5. Verification

- [ ] 5.1 Run root tests and typecheck plus web design lint, focused tests, typecheck, and production build; fix every failure.
- [ ] 5.2 Browser-drive Overview and Recall against an isolated Mnemosyne bank at phone and desktop widths, in system light and dark modes, using keyboard-only navigation and reduced motion; fix every behavioral, accessibility, and visual failure.
- [ ] 5.3 Measure 20 warm overview and recall requests; if either p95 exceeds one second, replace request-scoped MCP with one reconnecting process-scoped client and repeat verification.
- [ ] 5.4 Run `/openspec-verify-change add-memory-dashboard` and fix every issue.
