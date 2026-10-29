# Domain Documentation

This repository uses a **single-context** domain layout unified with the Agent Notes tree:

- **Ubiquitous Language & Glossary**: [`.agents/CONTEXT.md`](../../.agents/CONTEXT.md).
- **Architectural Decision Records (Agent Notes)**: Stored in [`.agents/notes/`](../../.agents/notes/README.md).

## Rules for Agents

1. Before implementing domain or process logic, consult [`.agents/CONTEXT.md`](../../.agents/CONTEXT.md) for agreed terminology.
2. When introducing new domain concepts or resolving overloaded vocabulary during `/grill-with-docs`, update [`.agents/CONTEXT.md`](../../.agents/CONTEXT.md).
3. Significant architectural decisions that are hard to reverse are recorded as Agent Notes under `.agents/notes/` following [`.agents/notes/README.md`](../../.agents/notes/README.md) rather than a separate `docs/adr/` folder.
