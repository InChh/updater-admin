# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

This task was created by the project's first `trellis init`. The frontend and
backend guidelines are now populated and remain in verification before the
task is finished and archived.

**Your job**: keep `.trellis/spec/` aligned with the repository's real coding
conventions. Verify both directions: every current project decision must be
covered or explicitly delegated to `AGENTS.md`, and every material guideline
claim must match current source, configuration, and tests. Record existing debt
as debt rather than presenting it as an implemented convention.

---

## Status (update the checkboxes as you complete each item)

- [x] Fill frontend guidelines
- [x] Fill backend guidelines
- [x] Add frontend and backend code examples

---

## Spec files to populate


### Frontend guidelines

| File | What to document |
|------|------------------|
| `.trellis/spec/frontend/directory-structure.md` | Component/page/hook organization |
| `.trellis/spec/frontend/component-guidelines.md` | Component patterns, props conventions |
| `.trellis/spec/frontend/hook-guidelines.md` | Custom hook naming, patterns |
| `.trellis/spec/frontend/state-management.md` | State library, patterns, what goes where |
| `.trellis/spec/frontend/type-safety.md` | TypeScript conventions, type organization |
| `.trellis/spec/frontend/quality-guidelines.md` | Linting, testing, accessibility |


### Backend guidelines

| File | What to document |
|------|------------------|
| `.trellis/spec/backend/directory-structure.md` | API/domain/repository/integration ownership |
| `.trellis/spec/backend/api-contracts.md` | Elysia routes, DTO alignment, errors, preconditions, public APIs |
| `.trellis/spec/backend/domain-and-persistence.md` | Domain validation, Drizzle transactions, audit, soft deletion |
| `.trellis/spec/backend/auth-and-security.md` | Better Auth, sessions, bootstrap, secrets, redaction |
| `.trellis/spec/backend/storage-and-uploads.md` | OSS STS, direct upload, reconciliation, release visibility |
| `.trellis/spec/backend/quality-and-operations.md` | Tests, migrations, deployment, monitoring, external gates |


### Thinking guides (already populated)

`.trellis/spec/guides/` contains general thinking guides pre-filled with
best practices. Customize only if something clearly doesn't fit this project.

---

## How to fill the spec

### Step 1: Import from existing convention files first (preferred)

Search the repo for existing convention docs. If any exist, read them and
extract the relevant rules into the matching `.trellis/spec/` files —
usually much faster than documenting from scratch.

| File / Directory | Tool |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / agent-compatible tools |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor (rules directory) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | General project conventions |
| `.editorconfig` | Editor formatting rules |

### Step 2: Analyze the codebase for anything not covered by existing docs

Scan real code to discover patterns. Before writing each spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Document anti-patterns the team clearly avoids.

### Step 3: Document reality, not ideals

**Critical**: write what the code *actually does*, not what it should do.
Sub-agents match the spec, so aspirational patterns that don't exist in the
codebase will cause sub-agents to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- On sub-agent-capable hosts, implementation and checking normally dispatch
  `trellis-implement` and `trellis-check`; inline hosts load the corresponding
  skills and execute in the main session.
- New sub-agent-mode tasks normally have `implement.jsonl` / `check.jsonl`
  manifests listing which spec and research files to load. This legacy
  bootstrap task currently has neither manifest, so its dispatched reviewers
  must receive the explicit active-task path and inspect the frontend/backend
  specs directly until manifest curation is separately authorized.
- A platform hook or agent-side fallback loads the task artifacts and curated
  manifests where present, so implementation and review use the same team
  conventions without manual prompt copies.
- Source of truth for coding conventions: `.trellis/spec/`; approved product,
  compatibility, environment, and release decisions remain in `AGENTS.md` as
  delegated by the spec indexes. Keeping both boundaries explicit is why this
  verification matters.

---

## Completion

When the developer confirms the checklist items above are done with real
examples, guide them to run:

```bash
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.

---
