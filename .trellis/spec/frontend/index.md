# Frontend Development Guidelines

> Verified frontend conventions for Updater Admin.

---

## Overview

This directory records the frontend conventions verified against the current
Updater Admin source tree. Follow the guide for the layer being changed and use
the cited source files as the reference implementations.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Complete |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Complete |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | Complete |
| [State Management](./state-management.md) | Local state, global state, server state | Complete |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Complete |
| [Type Safety](./type-safety.md) | Type patterns, validation | Complete |

---

## How to Use These Guidelines

For frontend work:

1. Read the guide for each affected concern.
2. Confirm that new code follows the cited production examples.
3. Apply the project-specific forbidden-pattern and review sections.
4. Update a guide when a verified convention changes.

These documents describe current practice, not a future-state architecture.

## Authority Boundary

Read `AGENTS.md` before substantial frontend work. It remains the source of
truth for approved product scope, compatibility exclusions, scaffold/toolchain
constraints, environment variables, deployment status, release gates, and
time-sensitive operational gotchas. These frontend guides refine the
source-backed coding conventions for this layer instead of duplicating that
changing operational record. The scaffold-era `.cursorrules` is secondary when
it conflicts with `AGENTS.md`, current configuration, or production-owned code.

---

**Language**: All documentation should be written in **English**.
