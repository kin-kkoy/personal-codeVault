# Code Vault — Product Spec

## 1. Overview

Code Vault is a local-first desktop application for storing, organizing, and quickly recognizing small code projects, snippets, experiments, utilities, and visual demos.

The main purpose of the app is not full code hosting or cloud collaboration. Its purpose is to help the user:

- store lightweight code/projects in one place
- visually recognize saved work quickly
- search and filter saved items easily
- reopen or reuse saved work later
- reduce the problem of “I know I made this before, but I can’t find it or remember what it does”

This app is intended primarily for personal use.

---

## 2. Problem Statement

A normal folder-based setup becomes messy over time when storing many small projects, code snippets, mini-apps, experiments, or prompt-generated outputs.

Common issues:

- filenames are not enough to recognize projects quickly
- folders become cluttered and hard to search mentally
- snippets and mini-projects are easy to forget
- reusable ideas/components are hard to rediscover
- visual projects are especially hard to identify without opening them
- code may exist, but its purpose/output is not obvious at a glance

The user wants a system that acts more like a visual library than a plain filesystem.

---

## 3. Goals

### Primary Goals
- Store small code-related items in a structured personal vault
- Recognize items visually through screenshots/previews
- Search and filter items quickly
- Reopen files/folders without digging through the filesystem
- Add enough metadata so items are understandable later

### Secondary Goals
- Mark useful items for reuse
- Support future template duplication
- Support future import automation
- Serve as a personal archive of experiments and lightweight tools

---

## 4. Non-Goals

The app is not intended to be:

- a GitHub replacement
- a full cloud collaboration platform
- a VM/container-based runtime environment
- a full IDE
- a large-project repository manager
- a production deployment tool
- a code execution sandbox for every language/framework

The app may later support launching/opening projects, but that is not the core purpose.

---

## 5. Target Users

### Primary User
A solo developer who creates many:
- small apps
- code snippets
- experiments
- reusable UI pieces
- utilities
- algorithmic/visual outputs
- prompt-generated code artifacts

### User Need
The user prefers visual recall and wants a faster way to identify, reopen, and reuse previous work.

---

## 6. Core Concept

Each saved item in the vault is an **entry**.

An entry represents something like:
- a snippet
- a mini-app
- a single-file demo
- a utility script
- a reusable component
- a prompt-generated output
- a starter/base project

Each entry should have:
- metadata
- preview image
- path to actual files/folder
- category/type
- searchable descriptors

---

## 7. MVP Scope

The MVP should focus only on the minimum features required to make the app useful.

### MVP Objective
Create a local visual catalog for small code projects/snippets with metadata, preview images, search, and quick-open actions.

### Included in MVP
- manual item creation
- item editing
- item deletion or archive
- preview image attachment
- item list/grid view
- search by title/tags
- basic filtering
- item detail view
- open folder / open file / copy path actions
- local persistence

### Excluded from MVP
- template duplication
- run command support
- automatic folder scanning
- export/import bundles
- automatic screenshot generation
- snippet relationships
- AI-generated metadata
- cloud sync
- semantic search

---

## 8. Entry Data Model

Each vault entry should support the following fields.

### Required Fields
- `id`
- `title`
- `type`
- `rootPath`

### Recommended Fields
- `description`
- `tags`
- `stack`
- `previewImagePath`
- `entryFilePath`
- `notes`
- `status`
- `createdAt`
- `updatedAt`

### Suggested Types
- `snippet`
- `mini-app`
- `component`
- `utility`
- `prompt-output`
- `template`
- `experiment`

### Suggested Status Values
- `draft`
- `usable`
- `polished`
- `archived`

---

## 9. MVP Features

## 9.1 Create Item
The user can manually create a new vault entry.

### Input Fields
- title
- description
- type
- tags
- stack/language
- root path
- optional entry file path
- optional preview image
- optional notes
- optional status

### Expected Result
The item is saved to the local database and appears in the vault list/grid view.

---

## 9.2 Browse Vault Items
The app displays saved items in a visual list or grid.

### Card Content
- preview image
- title
- short description
- type
- tags
- maybe updated date

### Purpose
This is the main recall surface of the app.

---

## 9.3 Search and Filter
The user can find items quickly.

### Minimum Search
- title
- tags

### Minimum Filters
- type
- stack/language (optional in MVP, recommended if easy)

### Purpose
Prevent the vault from becoming another cluttered list.

---

## 9.4 Item Detail View
Each item should have a fuller detail view.

### Detail Content
- larger preview
- title
- full description
- tags
- stack
- status
- notes
- root path
- entry file path
- actions

---

## 9.5 Quick Actions
From the detail view, and optionally from cards, the user can:

- open root folder
- open entry file
- copy root path
- view preview image

These actions make the vault directly useful.

---

## 9.6 Edit Item
The user can edit existing entry metadata.

Editable fields:
- title
- description
- type
- tags
- stack
- preview image
- notes
- status
- root path
- entry file path

---

## 9.7 Delete / Archive Item
The user can remove an item from the vault or archive it.

### Important Behavior
Deleting or archiving an entry should affect the vault record, not automatically delete the actual project files unless explicitly implemented and confirmed later.

Safer default:
- remove from vault only
- do not touch filesystem content

---

## 9.8 Local Persistence
All data should be stored locally.

### Suggested Storage
- SQLite for metadata
- filesystem paths for actual projects
- preview files stored in an app-managed directory or referenced by path

---

## 10. UX Principles

The app should feel:

- fast
- clean
- low-friction
- visually scannable
- practical over flashy

### UX Priorities
1. recognize items quickly
2. find items quickly
3. reopen items quickly
4. edit metadata easily

### Important UX Notes
- preview images are highly important
- avoid cluttered layouts
- card design should prioritize quick visual scanning
- actions should be obvious and minimal

---

## 11. Suggested Technical Direction

This is a suggested direction, not a hard requirement.

### Recommended App Form
Desktop app

### Recommended Stack
- Tauri
- React for UI
- SQLite for local database

### Reasoning
A desktop app is a better fit because:
- local file access matters
- opening folders/files matters
- local-first behavior is the core use case
- the app is personal and utility-focused

---

## 12. Risks and Constraints

### Risks
- overbuilding beyond the MVP
- trying to support too many item types too early
- trying to automate metadata before basic usability exists
- cluttered UI defeating the purpose of quick recognition

### Constraints
- must work locally
- should remain lightweight
- should not require cloud services for basic usage
- should not assume items are runnable in a standardized way

---

## 13. Success Criteria for MVP

The MVP is successful if the user can:

- add items manually
- attach a preview image
- see items as visual cards
- search/filter them
- open the correct folder/file quickly
- understand what each item is without rereading all the code

---

## 14. Future Expansion

Potential later features:

- template duplication
- import existing folders/projects
- batch import
- automatic stack detection
- multi-preview support
- favorites/pinned items
- snippet relationships
- command launching
- preview/code side-by-side
- auto screenshot generation
- export/import bundles
- cloud sync
- AI-generated summaries/tags

These are intentionally outside MVP scope unless priorities change.
