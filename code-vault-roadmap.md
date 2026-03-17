# Code Vault — Detailed Roadmap

## Overview

This roadmap breaks the project into progressive phases so the app can become useful early without becoming too large too quickly.

The phases are intentionally separated by value:

- Phase 1: make it usable
- Phase 2: make it better for reuse
- Phase 3: reduce manual work
- Phase 4: improve experience and polish
- Phase 5: add power-user and advanced features

---

# Phase 1 — MVP / Usable Core

## Goal
Build a local-first visual catalog for small code projects and snippets.

## Main Outcome
The user can manually add items with metadata and preview images, search them, and reopen them quickly.

## Features

### 1. App shell and navigation
- create main app layout
- define primary views
- decide whether navigation is sidebar-based or top-nav based
- include at least:
  - vault view
  - add item view/modal
  - item detail view

### 2. Local persistence
- set up local SQLite database
- define schema for vault items
- handle basic DB initialization/migrations
- ensure data persists across restarts

### 3. Item model
Define and implement the main item structure:
- id
- title
- description
- type
- tags
- stack
- root path
- entry file path
- preview image path
- notes
- status
- created at
- updated at

### 4. Manual item creation
- build add item form
- validate required fields
- support selecting folder path
- support optional entry file path
- support attaching preview image
- support tags
- save to DB

### 5. Vault list/grid view
- show all entries as cards
- include preview image
- include title
- include short description
- include type
- include tags
- optionally include updated date
- handle empty state cleanly

### 6. Item detail view
- show expanded information for one item
- larger preview image
- full description
- tags
- type
- stack
- notes
- path fields
- quick actions

### 7. Search and filters
At minimum:
- search by title
- search by tags
- filter by type

Optional if easy:
- filter by stack
- sort by updated date
- sort alphabetically

### 8. Quick actions
- open root folder
- open entry file
- copy root path
- copy entry file path
- open preview image if needed

### 9. Edit item
- update metadata
- replace preview image
- update notes
- update paths
- update tags/status/type

### 10. Delete or archive item
- remove from vault database or mark archived
- do not delete actual project files by default
- add confirmation for destructive actions

### 11. Basic UX polish
- loading states
- empty states
- form validation messages
- fallback preview placeholder
- simple clean layout
- prevent broken paths from crashing UI

## Todo Breakdown

### Foundation
- choose stack
- create project
- set up DB
- define schema
- set up state/data layer

### Core CRUD
- create item
- list items
- read item details
- edit item
- delete/archive item

### Preview support
- attach/select preview image
- store preview path
- render preview in cards/detail view

### Search and filters
- search input
- filter dropdown for type
- optional stack filter
- optional sorting

### File actions
- open folder
- open file
- copy path

### Stability
- validate bad/missing paths
- handle missing preview files
- preserve DB integrity

## Exit Criteria
Phase 1 is done when the app is already useful as a personal visual vault.

That means the user can:
- add entries
- browse them visually
- search/filter them
- inspect details
- reopen the correct project quickly

---

# Phase 2 — Organization and Reuse

## Goal
Make the vault better as a long-term library and reuse system.

## Main Outcome
The user can better organize items, mark important ones, and reuse stored items more intentionally.

## Features

### 1. Favorites / pinned items
- mark items as favorite
- pin important entries
- add favorite filter
- maybe add pinned section at top

### 2. Better categorization
- richer type/category system
- stronger tagging UX
- tag suggestions from existing tags
- status filtering
- better stack classification

### 3. Notes and reuse guidance
- expand notes support
- add “how to reuse” or “good for” field
- add “setup notes” field
- add “dependency notes” field

### 4. Template support
- allow marking item as template
- show template badge
- template-only filter
- explain that templates are intended as starters

### 5. Duplicate template
- create new project/folder from existing template item
- prompt for destination folder
- prompt for new name
- copy source files to destination
- optionally exclude common junk directories
- open new folder after duplication

### 6. Better item statuses
- draft
- usable
- polished
- archived
- maybe experimental

### 7. Related items / snippet relationships
- manually link one item to another
- examples:
  - “used in”
  - “derived from”
  - “variant of”
  - “pairs well with”
  - “same concept”
- show linked items in detail view

## Todo Breakdown

### Organization improvements
- favorite flag
- status badges
- type/category cleanup
- filters for favorite/status/template

### Reuse support
- template flag
- duplicate template flow
- destination selection
- post-copy success flow

### Relationship support
- manual linking UI
- relationship type definitions
- related item list in detail page

### Notes improvements
- richer notes fields
- reusable-purpose field
- setup/dependency notes

## Exit Criteria
Phase 2 is done when the vault is no longer just storage, but a practical reuse system.

That means the user can:
- identify best items quickly
- mark good starters
- duplicate starter projects
- understand how saved items relate to each other

---

# Phase 3 — Semi-Automation

## Goal
Reduce the amount of manual cataloging work.

## Main Outcome
The app helps the user import and interpret existing projects instead of requiring everything to be entered by hand.

## Features

### 1. Import existing items
- import folder into vault
- import single-file project/snippet
- import existing mini-app
- add metadata during import flow

### 2. Batch import
- select a root directory
- find candidate subfolders/files
- allow user to choose which ones to import
- assign common tags/categories during batch flow

### 3. Auto-detect stack/language
Examples:
- detect package.json => JS/TS/Node/React-ish project
- detect requirements.txt or pyproject.toml => Python project
- detect single `.html` file => HTML/CSS/JS snippet
- detect common project signatures

### 4. Auto-fill metadata where possible
- suggest title from folder name
- suggest stack from file types
- suggest type from structure
- suggest entry file from common files:
  - index.html
  - main.py
  - App.tsx
  - main.js

### 5. Better preview handling
- easier preview attachment during import
- optional multi-preview support
- preview replacement flow
- preview management UI

### 6. Manual run command support
Not full execution sandboxing.
Just allow saved commands such as:
- npm run dev
- python main.py
- open index.html

This can remain limited and optional.

### 7. Quick code/file preview
- basic file listing
- preview selected text/code files
- maybe readme preview
- maybe syntax-highlighted snippet preview later

## Todo Breakdown

### Import system
- import wizard
- folder picker
- file picker
- candidate scanning
- duplicate entry checks

### Metadata suggestions
- stack detection logic
- entry file suggestions
- title/type suggestions

### Preview handling
- simplify preview assignment
- support replacing/removing previews
- optional support for multiple previews

### Run support
- save run/open commands
- basic execute action
- clear warnings that execution is external/system-level

### Light preview
- directory tree summary
- code/file preview panel for known text files

## Exit Criteria
Phase 3 is done when adding existing work into the vault is much less manual.

That means the user can:
- import projects quickly
- accept metadata suggestions
- reduce repetitive form-filling
- optionally launch/open saved items more easily

---

# Phase 4 — Convenience and Polish

## Goal
Make the app feel smooth enough for regular long-term use.

## Main Outcome
The app becomes pleasant, efficient, and visually stronger rather than just functionally correct.

## Features

### 1. UI refinement
- cleaner card design
- better spacing and hierarchy
- improved detail view layout
- improved navigation
- better responsive behavior for window resizing

### 2. Better sorting and filtering
- sort by recently updated
- sort alphabetically
- sort by created date
- filter by favorites
- filter by status
- filter by templates
- compound filtering

### 3. Recent activity
- recently viewed items
- recently added items
- recently updated items

### 4. Better preview system
- multiple previews per item
- preview gallery in detail view
- thumbnail strip
- better placeholder behavior
- preview ordering

### 5. Duplicate detection
- detect similar paths
- warn on repeated imports
- identify likely duplicate titles
- optionally merge or keep separate

### 6. Better path/file health checks
- detect missing paths
- detect moved folders
- show broken link indicators
- add repair/relink flow

### 7. Better UX around notes and metadata
- inline editing
- better tag entry UX
- markdown notes support if useful
- richer item summaries

## Todo Breakdown

### UI work
- redesign cards
- improve detail page
- improve modal/forms
- better empty states and feedback

### Search/filter improvements
- advanced filter bar
- combined filters
- stable sorting options

### Maintenance UX
- path health checks
- duplicate warnings
- relink moved paths

### Preview polish
- multi-image support
- gallery interactions
- better fallback behavior

## Exit Criteria
Phase 4 is done when the app feels polished enough to be something you naturally keep using, not just tolerate.

---

# Phase 5 — Advanced / Power-User Features

## Goal
Turn the vault into a more intelligent and scalable personal developer library.

## Main Outcome
The app goes beyond manual cataloging and starts offering higher-level convenience and automation.

## Features

### 1. Automatic screenshot generation
For supported project types:
- generate preview screenshots for HTML demos
- maybe generate screenshots for local web apps
- maybe use browser automation for preview capture

### 2. Export/import bundles
- export entry metadata as JSON
- export files + metadata + previews as portable bundle
- import bundles on another machine
- support backup and restore flows

### 3. Cloud sync
- optional sync to Google Drive or another storage
- sync metadata DB backup
- sync preview assets
- maybe sync bundle exports instead of live DB

### 4. AI-generated metadata
- suggest title
- summarize project purpose
- suggest tags
- classify item type
- generate “good for reuse as…” notes

### 5. Semantic search
- search by meaning, not just exact keywords
- example:
  - “that particle orb thing”
  - “small downloader UI”
  - “canvas animation”
- likely requires embeddings or metadata enrichment

### 6. Similarity suggestions
- show related items automatically
- detect likely variants or duplicates
- show “you may also reuse this” suggestions

### 7. Smarter template system
- placeholder variables
- rename package/app during duplication
- ignore unnecessary folders/files
- post-copy setup steps
- dependency install prompt

### 8. Command presets and environments
- save open/run presets
- maybe per-language runners
- maybe safe launch modes
- maybe command history per item

## Todo Breakdown

### Portability
- export format design
- import format design
- backup/restore flow

### Intelligence
- metadata generation
- AI summarization
- semantic indexing/search
- relationship suggestions

### Automation
- screenshot automation
- smarter duplicate detection
- smarter template duplication

### Sync
- choose sync model
- conflict handling
- backup strategy

## Exit Criteria
Phase 5 is done when the vault behaves more like a serious long-term personal knowledge/tool system rather than just a catalog.

---

# Suggested Build Order Summary

## Recommended order
1. Phase 1 completely
2. Phase 2 selectively
3. Phase 3 import features
4. Phase 4 polish
5. Phase 5 only if the app proves worth deepening

## Recommended caution
Do not rush into:
- AI metadata
- cloud sync
- automatic screenshot generation
- complex command execution
- semantic search

Those are attractive, but they are not the reason the app becomes useful in the first place.

The app becomes useful when:
- it stores items cleanly
- you can identify items quickly
- you can reopen and reuse them fast
