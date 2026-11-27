# Node or Bun documentation

Read the [agent instructions](../AGENTS.md) before changing code. Choose only the documents relevant to the task; this index does not expand the supported process contract.

## Choose a task

| Task | Start here |
| --- | --- |
| Use the public process API | [Repository README](../README.md), [process contract](process-contract.md) |
| Understand scope and guarantees | [Plan scope](plan-scope.md), [backend decision](decisions/backend.md), [modularity boundaries](decisions/modularity-boundaries.md) |
| Change implementation or adapters | [Process contract](process-contract.md), [refactor plan](refactor-plan-2026-11-06.md) |
| Upgrade an existing consumer | [0.1 to 0.2](migration-0.1-to-0.2.md), [0.2.0 to 0.2.1](migration-0.2.0-to-0.2.1.md) |
| Qualify or publish a release | [Releases](releases.md), [changelog](../CHANGELOG.md), [dated release evidence](decisions/evidence/) |

## Document organization

Keep durable architecture decisions in [decisions](decisions/), migration instructions separate from the process contract, and dated evidence distinct from current guarantees. Existing document paths remain stable; add future documents by responsibility and update this map when a canonical entry changes. A plan or old qualification receipt is not evidence that a new version has passed verification.
