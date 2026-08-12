## Purpose

Delivers the memories a session needs before it knows what it is about — the user's standing rules and the current project's memory index — once at the start, and leaves every further retrieval to the agent.

## ADDED Requirements

### Requirement: Standing memory reaches the model once per session and stays

The system SHALL deliver a session recall block on the first agent turn of a session, SHALL NOT repeat it on later turns of that session, and SHALL deliver it through a channel whose content remains in the model's context for the rest of the session.

#### Scenario: First turn of a session

- **WHEN** a session's first agent turn begins
- **THEN** the session recall block is delivered

#### Scenario: Later turns of the same session

- **WHEN** a second or later agent turn begins in the same session
- **THEN** no session recall block is delivered, and the block delivered on the first turn is still in the model's context

#### Scenario: A new session in the same process

- **WHEN** a session is started, resumed, or forked while the previous session's process is still running
- **THEN** the new session's first turn carries the session recall block

#### Scenario: A new session in the same working directory

- **WHEN** a session ends and a new one starts in the same working directory
- **THEN** the new session's first turn carries the session recall block

### Requirement: The standing block is the only automatic injection

No memory SHALL reach the model automatically other than the standing block. Retrieval beyond it SHALL be the agent's own call through the recall tool, and the standing block SHALL name that tool so the agent knows what it holds and how to reach the rest.

#### Scenario: An ordinary turn

- **WHEN** any agent turn after the first begins
- **THEN** no memory is retrieved and nothing is added to the model's context

#### Scenario: The agent needs memory

- **WHEN** the agent decides it needs a memory the standing block does not carry
- **THEN** it retrieves it by calling the recall tool itself

#### Scenario: The block points beyond itself

- **WHEN** the standing block is delivered
- **THEN** it names the recall tool as the way to reach memory it does not carry

### Requirement: Injection ignores the prompt gates

The session recall block SHALL be delivered independently of prompt length and of leading slash-commands, both of which suppress the retention path.

#### Scenario: Session opens with an acknowledgement

- **WHEN** the first prompt of a session is shorter than the minimum prompt length
- **THEN** the session recall block is still delivered

#### Scenario: Session opens with a slash-command

- **WHEN** the first prompt of a session begins with a host slash-command
- **THEN** the session recall block is still delivered

### Requirement: The block carries global standing rules

The session recall block SHALL include every live global memory whose importance is at or above a configured floor, and every live global memory whose source names a configured index, ordered by importance and then by recency.

#### Scenario: A rule above the floor

- **WHEN** a live global memory has importance at or above the floor
- **THEN** its content appears in the block

#### Scenario: An index below the floor

- **WHEN** a live global memory sits below the floor and its source names a configured index
- **THEN** its content appears in the block

#### Scenario: An ordinary global memory

- **WHEN** a live global memory sits below the floor and its source names no configured index
- **THEN** its content is absent from the block

### Requirement: The block carries the current project's index

The session recall block SHALL include every live memory whose source is the current project's index, resolved through the same project namespace that retention writes to, and SHALL truncate any such entry that exceeds a per-entry length cap.

#### Scenario: A project with index entries

- **WHEN** the current project's index holds live memories
- **THEN** their content appears in the block under the project's name

#### Scenario: A project with no index entries

- **WHEN** the current project's index holds no live memories
- **THEN** the block names the project and states the source to write its index entries to

#### Scenario: An oversized index entry

- **WHEN** a project index entry exceeds the per-entry cap
- **THEN** the block carries a truncated form marked as truncated

#### Scenario: A linked worktree

- **WHEN** the working directory is a linked worktree of a repository
- **THEN** the block carries the parent repository's project index

### Requirement: Superseded, consolidated, and expired memories are excluded

The session recall block SHALL exclude any memory that has been superseded, that has been consolidated away, or whose validity has expired.

#### Scenario: A superseded memory

- **WHEN** a memory that would otherwise qualify has been superseded
- **THEN** its content is absent from the block

#### Scenario: An expired memory

- **WHEN** a memory that would otherwise qualify has a validity date in the past
- **THEN** its content is absent from the block

### Requirement: Injection is untrusted context and fails open

The session recall block SHALL be labelled as untrusted background context that current user messages and tool output take precedence over, and SHALL be escaped so its content cannot close or forge the surrounding markup. An unreadable bank, a missing driver, or a read error SHALL leave the turn usable with no block.

#### Scenario: Memory content contains markup

- **WHEN** a qualifying memory's content contains angle brackets or ampersands
- **THEN** the block carries the content escaped

#### Scenario: The bank is unreadable

- **WHEN** the bank file is absent or cannot be opened
- **THEN** the turn proceeds with no session recall block and no error surfaced to the user

### Requirement: The block is bounded as a whole

The session recall block SHALL be held within a configured character budget, admitting entries in the order the block presents them and stopping before the entry that would exceed it.

#### Scenario: Qualifying memories fit the budget

- **WHEN** the qualifying memories total less than the budget
- **THEN** every qualifying memory appears in the block

#### Scenario: Qualifying memories exceed the budget

- **WHEN** the qualifying memories total more than the budget
- **THEN** the block carries the highest-importance entries up to the budget and reports how many were withheld

### Requirement: Injection is configurable and can be disabled

The importance floor, the index source names, the per-entry cap, the whole-block budget, and session recall itself SHALL each be configurable through the environment, and disabling session recall SHALL leave retention and the agent's own recall tool unaffected.

#### Scenario: Session recall disabled

- **WHEN** session recall is disabled through configuration
- **THEN** no session delivers a block, retention still stores settled turns, and the agent can still call the recall tool

#### Scenario: A raised importance floor

- **WHEN** the importance floor is configured above a memory's importance
- **THEN** that memory is absent from the block unless its source names a configured index
