## Purpose

Provide a local, read-only view of Mnemosyne bank health and recall behavior without exposing storage internals or mutation controls to the browser.

## ADDED Requirements

### Requirement: Local read-only access
The dashboard SHALL listen only on a loopback address, SHALL reject browser requests with a non-loopback Host or foreign Origin, SHALL emit no permissive CORS headers, and SHALL expose only read operations through its browser-facing interface.

#### Scenario: Dashboard starts
- **WHEN** an operator starts the dashboard
- **THEN** the service listens only on a loopback address

#### Scenario: Foreign browser origin submits a request
- **WHEN** a request carries a non-loopback Host or a foreign Origin
- **THEN** the service rejects it before invoking Mnemosyne

#### Scenario: Browser inspects memory state
- **WHEN** the browser requests dashboard data
- **THEN** the service performs no memory create, update, invalidate, forget, hygiene-clean, import, export, persona, triple, or sync mutation

### Requirement: Compatible statistics contract
The dashboard SHALL require an explicit supported `mnemosyne_stats` schema version and SHALL block all dashboard data views with an actionable incompatibility error when the installed server does not satisfy that contract.

#### Scenario: Supported server responds
- **WHEN** Mnemosyne returns the required statistics schema version
- **THEN** the dashboard accepts the statistics response and displays the server and schema versions

#### Scenario: Legacy or incompatible server responds
- **WHEN** Mnemosyne omits or returns an unsupported statistics schema version
- **THEN** the dashboard identifies the installed server version, states the required schema version, and does not adapt the legacy response

### Requirement: Connectivity health
The overview SHALL present a headline health state derived from the required MCP connectivity and statistics contract. It SHALL report healthy when both succeed, degraded when a configured optional sync source fails, and unavailable when MCP connectivity or compatibility fails. An unconfigured sync source SHALL NOT degrade health.

#### Scenario: Required checks succeed
- **WHEN** MCP responds with a compatible statistics payload and no configured optional source fails
- **THEN** the overview reports healthy

#### Scenario: Configured sync check fails
- **WHEN** required checks succeed but configured sync status cannot be retrieved
- **THEN** the overview reports degraded and identifies sync as unavailable

#### Scenario: Required check fails
- **WHEN** MCP cannot connect or its statistics contract is incompatible
- **THEN** the overview reports unavailable

### Requirement: Bank overview
The overview SHALL display the logical bank name, database filename, physical and recallable memory counts, physical and recallable distinct session counts, separately labeled BEAM tier counts, sync state, and last refresh time when each value is available. Recallable counts SHALL include only non-superseded memories whose expiry has not passed. Session counts SHALL count distinct session identifiers in the corresponding physical or recallable set. Metrics from different Mnemosyne subsystems SHALL NOT be combined into a single total.

#### Scenario: All overview sources are available
- **WHEN** the overview loads while compatible statistics and sync status are available
- **THEN** it displays every value with its exact source-specific label

#### Scenario: Optional sync source is unavailable
- **WHEN** compatible statistics are available but configured sync status fails
- **THEN** the overview marks sync unavailable without hiding the available bank statistics

#### Scenario: Operator inspects the bank location
- **WHEN** the overview first renders
- **THEN** it shows the bank name and database filename while keeping the full path concealed behind an explicit reveal or copy action

### Requirement: Overview freshness
The dashboard SHALL refresh overview data on overview navigation and when its browser window regains focus. It SHALL display the successful refresh time and SHALL NOT automatically repeat a recall probe.

#### Scenario: Window regains focus
- **WHEN** the dashboard window regains focus
- **THEN** it refreshes overview data and leaves any recall probe unexecuted

### Requirement: Recall probe
The dashboard SHALL accept a non-empty prompt and a result limit from 1 through 20 inclusive, defaulting to 5, then execute a Mnemosyne recall and display each returned memory in rank order with all score and metadata fields supplied by Mnemosyne.

#### Scenario: Recall returns matches
- **WHEN** an operator submits a valid prompt
- **THEN** the dashboard displays ranked collapsed previews with available score, tier, source, scope, timestamp, expiry, and recall-count data

#### Scenario: Operator expands a result
- **WHEN** an operator explicitly expands a collapsed result
- **THEN** the dashboard reveals that result's full memory content without persisting the expansion or content

#### Scenario: Recall returns no matches
- **WHEN** a valid prompt produces no memories
- **THEN** the dashboard displays an explicit empty result state

#### Scenario: Recall input is invalid
- **WHEN** an operator submits an empty prompt or a result limit outside 1 through 20
- **THEN** the dashboard rejects the request without invoking Mnemosyne

### Requirement: Recall explanation
The recall probe SHALL offer an explanation toggle that is off by default. When enabled, it SHALL request Mnemosyne's structured explanation and display it as a request-level diagnostic panel separate from individual result content.

#### Scenario: Explanation is disabled
- **WHEN** an operator submits a recall with the explanation toggle off
- **THEN** the dashboard does not request or render an explanation trace

#### Scenario: Explanation is enabled
- **WHEN** an operator submits a recall with the explanation toggle on
- **THEN** the dashboard displays the returned structured request trace without rendering raw JSON as the primary presentation

### Requirement: Sensitive recall data stays ephemeral
The dashboard SHALL transmit recall prompts in request bodies rather than URLs and SHALL NOT persist prompts, explanation traces, expanded state, or returned memory content.

#### Scenario: Recall completes
- **WHEN** a recall request succeeds or fails
- **THEN** its sensitive values are absent from route URLs, browser-managed persistent storage, and dashboard logs

### Requirement: Responsive and accessible operation
The overview and recall views SHALL remain fully operable from phone through desktop widths and SHALL support keyboard navigation, visible focus, semantic labels, sufficient text contrast, and reduced-motion preferences.

#### Scenario: Operator uses a narrow viewport
- **WHEN** the dashboard is viewed at a supported phone width
- **THEN** navigation, overview metrics, recall input, results, expansion controls, and explanation trace remain usable without horizontal page scrolling

#### Scenario: Operator uses a keyboard
- **WHEN** an operator navigates and operates the dashboard without a pointing device
- **THEN** every interactive control is reachable, visibly focused, and correctly labeled

### Requirement: Mnemosyne failures remain inspectable
The dashboard SHALL preserve its compact top navigation and render a clear unavailable or error state when the Mnemosyne process cannot start, times out, disconnects, or returns malformed data. A failed recall SHALL clear prior results before displaying its current error.

#### Scenario: Mnemosyne is unavailable at startup
- **WHEN** the dashboard cannot establish its Mnemosyne connection
- **THEN** the overview identifies the connection failure and navigation remains usable

#### Scenario: Recall fails
- **WHEN** Mnemosyne fails while processing a recall probe
- **THEN** the recall view displays the failure without showing stale results as current
