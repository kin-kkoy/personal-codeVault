# AGENTS.md

## Project
This repository is for **Code Vault**, a local-first desktop app for storing, organizing, and visually recognizing small code projects, snippets, experiments, mini-apps, prompt outputs, and reusable code artifacts.

## Source of truth
- Primary spec: `code-vault-spec.md`
- Secondary reference: `code-vault-roadmap.md`

## Scope rules
- Build **Phase 1 / MVP only**.
- Do not implement later-phase features unless they are strictly necessary for clean MVP architecture.
- Do not add advanced features such as:
  - template duplication
  - snippet relationships
  - import/export bundles
  - automatic folder scanning
  - automatic screenshot generation
  - cloud sync
  - AI-generated metadata
  - semantic search
  - complex command execution

## MVP goal
Build a usable local visual catalog for small code projects/snippets with:
- manual item creation
- preview image attachment
- item list/grid view
- search/filter
- item detail view
- quick open/copy actions
- edit item
- delete/archive item
- local persistence

## Product expectations
- Keep the app local-first.
- Prioritize practicality, clarity, and maintainability.
- Keep dependencies minimal.
- Avoid overengineering.
- Use simple, clean architecture.
- Make the UI visually scannable and easy to use.
- Preview images are important and should be treated as a first-class part of the UX.

## Technical direction
Preferred stack unless there is a strong reason otherwise:
- Tauri 2
- React
- TypeScript
- SQLite

If a different stack is chosen, explain why before proceeding.

## Workflow rules
Before major coding:
1. summarize the MVP scope
2. propose the stack
3. propose folder structure
4. propose implementation plan

Then implement.

After implementation:
- run the app
- fix obvious build/runtime issues
- summarize what was built
- list anything intentionally deferred

## Guardrails
- Do not silently expand scope.
- Do not invent features not present in the spec.
- Do not prioritize “cool” features over core usability.
- Do not treat the roadmap as permission to build beyond MVP.
