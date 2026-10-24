# Domain Docs

How the engineering skills consume this repo's domain documentation. This repo is a single-context project.

## Layout

```text
/
├── AGENTS.md
├── GLOSSARY.md          ← create lazily; does not exist yet
├── docs/
│   ├── adr/             ← create lazily; does not exist yet
│   └── *.md             ← existing architecture and usage docs (Chinese)
└── src/
```

- **Vocabulary**: `GLOSSARY.md` at the repo root.
- **ADRs**: `docs/adr/`.
- Neither exists yet. Do not create an empty glossary or ADR directory merely to satisfy this configuration; create them when a requested term or decision needs recording.
- The existing `docs/*.md` files describe the app's architecture and terminology. Use their vocabulary. Do not rename them to match the default names.
- The project's design and usage docs are written in Chinese; keep new domain terms consistent with the language already used in `docs/`.

## Select the vocabulary documents

Use locations explicitly declared by the user, project instructions, or this configuration first. Otherwise read `GLOSSARY.md`. There is no `GLOSSARY-MAP.md` or `CONTEXT-MAP.md`; this is a single-context repo. Legacy `CONTEXT.md` is not present.

Keep the existing filename and location. If a needed term is absent, check whether it is a real vocabulary gap or a synonym the project avoids. Reading or explaining the terminology does not invoke a writing workflow.

## Use the glossary's vocabulary

When naming a domain concept in an issue title, refactor proposal, hypothesis, or test, use the term defined in the selected glossary. If a needed term is absent, check whether it is a real vocabulary gap or a synonym the project avoids.

## Read and write ADRs

Read ADRs that touch the area in scope. Missing optional domain documents do not block ordinary work. Reading vocabulary and ADRs is read-only; create or change them only when the task requests that artifact or decision record.

## Flag ADR conflicts

If an output contradicts an existing ADR, surface the conflict and its reason rather than silently overriding the decision.
