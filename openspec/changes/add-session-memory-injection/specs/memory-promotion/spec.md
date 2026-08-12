## Purpose

Gives a memory a way to change what it reaches: a project fact that recurs elsewhere widens to global standing, and a durable project fact moves into the project index that every session opens with.

## ADDED Requirements

### Requirement: Candidate memories are inspectable

The system SHALL list memories from the current project's namespace with the identifier, source, scope, importance, validity, and a content excerpt for each, so a memory can be chosen for transition without opening the bank directly. The default listing SHALL show the promotion candidates — live rows below the recall floor — most recent first, under a configurable limit.

#### Scenario: Listing a project's promotion candidates

- **WHEN** the operator lists memories from within a project
- **THEN** the project's live sub-floor memories are shown most recent first, each with its identifier, source, scope, importance, validity, and excerpt

#### Scenario: A project with more candidates than the limit

- **WHEN** the project's namespace holds more candidates than the limit
- **THEN** the listing stops at the limit and reports the number withheld

#### Scenario: Listing every memory in the namespace

- **WHEN** the operator asks for the unfiltered listing
- **THEN** every live memory in the project's namespace is shown, subject to the limit

#### Scenario: Listing from a project with no memories

- **WHEN** the operator lists memories from a project whose namespace holds none
- **THEN** the result is empty and reported as such

### Requirement: A memory can be promoted to global standing

Promotion SHALL set a memory's scope to global, move its source out of the project namespace to an operator-supplied global source, and raise its importance to a fixed promoted value that does not vary with the environment's configured recall floor. Promotion SHALL leave the memory's content, identifier, and recall history unchanged.

#### Scenario: Promoting a project memory

- **WHEN** the operator promotes a memory in the project namespace to a global source
- **THEN** the memory carries global scope, the supplied source, and the promoted importance, under its original identifier

#### Scenario: Promoting under a lowered recall floor

- **WHEN** the operator promotes a memory in an environment whose configured recall floor sits below the promoted importance
- **THEN** the memory still carries the promoted importance

#### Scenario: The promoted memory reaches the next session

- **WHEN** a session starts in any project after a promotion
- **THEN** the promoted memory appears in that session's session recall block

#### Scenario: Promotion without a target source

- **WHEN** the operator promotes a memory without supplying a global source
- **THEN** the promotion is rejected and the memory is unchanged

### Requirement: A memory can be made permanent in its project index

Pinning SHALL clear a memory's validity date, set its source to the current project's index, and mark the memory pinned so consolidation leaves it in place. Pinning SHALL leave the memory's content, identifier, and recall history unchanged.

#### Scenario: Pinning an expiring memory

- **WHEN** the operator pins a memory that carries a validity date
- **THEN** the memory carries no validity date, the current project's index as its source, and is marked pinned

#### Scenario: Consolidation after a pin

- **WHEN** consolidation runs over a bank holding a pinned memory
- **THEN** the pinned memory remains available to the next session's project index block

#### Scenario: The pinned memory reaches the next session in that project

- **WHEN** a session starts in that project after a pin
- **THEN** the pinned memory appears in that session's project index block

### Requirement: Transitions are confirmed and reversible in effect

Every transition SHALL report the memory's before and after state, and SHALL reject an unknown identifier without altering the bank.

#### Scenario: A transition reports its effect

- **WHEN** a promotion or pin succeeds
- **THEN** the memory's scope, source, importance, and validity are reported both as they were and as they now are

#### Scenario: An unknown identifier

- **WHEN** the operator names an identifier that no memory carries
- **THEN** the command reports the identifier as unknown and the bank is unchanged
