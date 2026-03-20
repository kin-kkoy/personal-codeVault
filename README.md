# Code Vault

A local-first desktop app for storing, organizing, and visually browsing your code projects, snippets, experiments, and reusable artifacts. Built with Tauri 2, React, TypeScript, and SQLite.

Everything stays on your machine — no accounts, no cloud, no telemetry.

---

## Features

**Organize anything code-related**
- Snippets, mini-apps, web apps, mobile apps, components, utilities, prompt outputs, experiments, and templates
- Tag, categorize by type/status, mark favorites, pin important items

**Visual browsing**
- Preview images attached to entries with carousel auto-cycling
- Compact and standard grid layouts
- Search by title, tag, or stack — filter by type, status, favorites, pinned, templates

**Entry detail panel**
- Full metadata editing inline or via form
- Notes, setup instructions, dependency notes, "good for" descriptions
- Run commands directly from the app
- Quick file preview for source code

**Relationships**
- Link related entries (used-in, derived-from, variant-of, pairs-well-with, same-concept)
- Relationship count indicators on cards

**Templates**
- Mark any entry as a template
- Duplicate templates to a new directory with one click

**Import & batch operations**
- Scan folders or files to auto-detect metadata
- Batch import with per-candidate review
- Bulk path repair when you move project directories

**Portability**
- Export/import individual entry bundles (metadata + previews + source files)
- Full vault backup and restore
- Everything stored as portable JSON + file archives

**Persistent layout**
- Sidebar sizes, filters, selected entry, grid density, dock state — all remembered across sessions

---

## Installation

### Pre-built executables

Download the latest release for your platform from the [Releases](../../releases) page:

| Platform | File | Notes |
|---|---|---|
| **Linux** (Ubuntu, Mint, Debian) | `code-vault_x.x.x_amd64.deb` | Double-click to install, or `sudo dpkg -i code-vault_*.deb` |
| **Linux** (any distro) | `code-vault_x.x.x_amd64.AppImage` | `chmod +x *.AppImage` then double-click or run `./Code-Vault_*.AppImage` |
| **Windows** | `code-vault_x.x.x_x64-setup.exe` | Run the installer |
| **macOS** (Apple Silicon) | `code-vault_x.x.x_aarch64.dmg` | Open the .dmg and drag to Applications |
| **macOS** (Intel) | `code-vault_x.x.x_x64.dmg` | Open the .dmg and drag to Applications |

### Linux Mint / Cinnamon

```bash
# Option A: .deb package (recommended)
sudo dpkg -i code-vault_*.deb

# Option B: AppImage (no install needed)
chmod +x Code-Vault_*.AppImage
./Code-Vault_*.AppImage

# To add AppImage to your menu, right-click the desktop
# or use a tool like AppImageLauncher
```

### Build from source

Requires: **Node.js 20+**, **Rust 1.75+**, and platform-specific dependencies.

```bash
git clone https://github.com/kin-kkoy/personal-codeVault.git
cd personal-codeVault
npm install
```

**Linux** — install system dependencies first:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf
```

**Build and run in dev mode:**

```bash
npm run tauri:dev
```

**Build a release executable:**

```bash
npm run tauri:build
```

The built executable and installer will be in `src-tauri/target/release/bundle/`.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | [Tauri 2](https://v2.tauri.app) |
| Frontend | React 19, TypeScript, Vite |
| Backend | Rust, SQLite (rusqlite) |
| Styling | Vanilla CSS with custom properties |
| Storage | Local SQLite database + filesystem |

**Bundle size:** ~92 kB gzipped (frontend). Three production dependencies (React, ReactDOM, Tauri API). Release binary is optimized with LTO, symbol stripping, and size-optimized codegen.

---

## Project structure

```
src/
  renderer/       React frontend (App.tsx, styles.css)
  shared/         Shared types, utilities, defaults
src-tauri/
  src/lib.rs      Rust backend — all Tauri commands and SQLite operations
  Cargo.toml      Rust dependencies
  tauri.conf.json Tauri app configuration
```

---

## License

MIT
