import { useMemo, useState, useRef, useEffect, type ReactElement } from 'react'

type HelpSection = {
  id: string
  title: string
  category: string
  content: ReactElement
}

type HelpFaq = {
  question: string
  sectionId: string
}

const helpCategories = [
  { id: 'start', label: 'Getting Started' },
  { id: 'manage', label: 'Managing Entries' },
  { id: 'media', label: 'Previews & Media' },
  { id: 'browse', label: 'Search & Display' },
  { id: 'io', label: 'Import & Export' },
  { id: 'connect', label: 'Connections & Repair' },
  { id: 'ref', label: 'Reference' }
]

const faqItems: HelpFaq[] = [
  // "What is..." questions for quick feature lookup
  { question: 'What is Code Vault?', sectionId: 'layout' },
  { question: 'What is the root path?', sectionId: 'creating' },
  { question: 'What is the entry file?', sectionId: 'creating' },
  { question: 'What is Detect Metadata?', sectionId: 'creating' },
  { question: 'What is Quick Edit?', sectionId: 'editing' },
  { question: 'What is archiving?', sectionId: 'delete-archive' },
  { question: 'What is favoriting?', sectionId: 'fav-pin' },
  { question: 'What is pinning?', sectionId: 'fav-pin' },
  { question: 'What is a template?', sectionId: 'templates' },
  { question: 'What is template duplication?', sectionId: 'templates' },
  { question: 'What is the run command?', sectionId: 'run-command' },
  { question: 'What is a preview image?', sectionId: 'previews' },
  { question: 'What is file preview?', sectionId: 'file-preview' },
  { question: 'What is importing?', sectionId: 'importing' },
  { question: 'What is batch import?', sectionId: 'importing' },
  { question: 'What is an entry bundle?', sectionId: 'export-bundle' },
  { question: 'What is exporting?', sectionId: 'export-bundle' },
  { question: 'What is a vault backup?', sectionId: 'backup-restore' },
  { question: 'What is restore?', sectionId: 'backup-restore' },
  { question: 'What is a relationship?', sectionId: 'relationships' },
  { question: 'What is Bulk Repair?', sectionId: 'repair' },
  { question: 'What is path health?', sectionId: 'repair' },
  { question: 'What is Health & Portability?', sectionId: 'repair' },
  { question: 'What is the dock panel?', sectionId: 'layout' },
  { question: 'What is Portability?', sectionId: 'backup-restore' },
  { question: 'What are entry types?', sectionId: 'entry-types' },
  { question: 'What are entry statuses?', sectionId: 'entry-statuses' },
  { question: 'What are relationship types?', sectionId: 'rel-types' },
  // "How do I..." questions
  { question: 'How do I add a new project?', sectionId: 'creating' },
  { question: 'How do I set the root path?', sectionId: 'creating' },
  { question: 'How do I set the entry file path?', sectionId: 'creating' },
  { question: 'How do I edit an existing entry?', sectionId: 'editing' },
  { question: 'How do I use Quick Edit?', sectionId: 'editing' },
  { question: 'How do I delete an entry?', sectionId: 'delete-archive' },
  { question: 'How do I archive an entry?', sectionId: 'delete-archive' },
  { question: 'How do I add a preview image?', sectionId: 'previews' },
  { question: 'How do I remove or reorder previews?', sectionId: 'previews' },
  { question: 'How do I favorite or pin an entry?', sectionId: 'fav-pin' },
  { question: 'How do I mark something as a template?', sectionId: 'templates' },
  { question: 'How do I duplicate a template?', sectionId: 'templates' },
  { question: 'How do I search and filter?', sectionId: 'search-filter' },
  { question: 'How do I switch between grid and list view?', sectionId: 'views-themes' },
  { question: 'How do I switch between light and dark mode?', sectionId: 'views-themes' },
  { question: 'How do I import a project from disk?', sectionId: 'importing' },
  { question: 'How do I batch import multiple projects?', sectionId: 'importing' },
  { question: 'How do I link related entries?', sectionId: 'relationships' },
  { question: 'How do I remove a relationship?', sectionId: 'relationships' },
  { question: 'How do I fix a broken path?', sectionId: 'repair' },
  { question: 'How do I fix many broken paths at once?', sectionId: 'repair' },
  { question: 'How do I export an entry?', sectionId: 'export-bundle' },
  { question: 'How do I import an entry bundle?', sectionId: 'export-bundle' },
  { question: 'How do I back up the entire vault?', sectionId: 'backup-restore' },
  { question: 'How do I restore a vault backup?', sectionId: 'backup-restore' },
  { question: 'How do I run a saved command?', sectionId: 'run-command' },
  { question: 'How do I preview a file inside an entry?', sectionId: 'file-preview' },
  { question: 'How do I resize the sidebar or detail panel?', sectionId: 'resizing' }
]

const sections: HelpSection[] = [
  {
    id: 'layout',
    title: 'App Layout',
    category: 'start',
    content: (
      <>
        <p>Code Vault is a local-first desktop app that saves links to your project folders. It does not copy or move your files — it just keeps an organized catalog of everything you've built.</p>
        <p>The app has three main columns:</p>
        <ul>
          <li><strong>Left Sidebar</strong> — Workspace Tools (Import, Bulk Repair, Portability) and the Filters panel for searching and filtering entries.</li>
          <li><strong>Main Workspace</strong> — Shows your entries as cards in a grid or list. The toolbar above shows the entry count, card size slider, and view toggle. Below the cards, a <strong>Dock Panel</strong> can open for Import, Bulk Repair, or Portability workflows.</li>
          <li><strong>Right Detail Panel</strong> — Shows everything about the selected entry: preview image, title, metadata, and collapsible accordion sections for quick actions, editing, file preview, gallery, relationships, and more.</li>
        </ul>
        <p>Click any entry card in the main area to select it and see its details on the right.</p>

        <h4>The Dock Panel</h4>
        <p>When you click Import, Bulk Repair, or Portability in the sidebar, a dock panel opens at the bottom of the workspace (like VS Code's terminal panel). You can:</p>
        <ul>
          <li>Have multiple dock tabs open at the same time.</li>
          <li>Switch between tabs by clicking them in the dock header.</li>
          <li>Close a tab with the X button on the tab.</li>
          <li>Resize the dock by dragging the top edge.</li>
          <li>Toggle between focused (one tab) and split (all tabs side by side) view.</li>
          <li>Collapse or expand the dock with the chevron button.</li>
        </ul>
      </>
    )
  },
  {
    id: 'creating',
    title: 'Creating an Entry',
    category: 'start',
    content: (
      <>
        <h4>Step 1: Open the form</h4>
        <p>Click the <strong>New entry</strong> button in the top-right corner of the main area. A full-screen overlay form opens.</p>

        <h4>Step 2: Set the root path</h4>
        <p>The <strong>Root path</strong> is the folder on your computer where this project lives. This is the only required field besides the title.</p>
        <ol>
          <li>Find the <strong>Root path</strong> field in the form.</li>
          <li>Either type the full folder path, or click the <strong>Browse</strong> button next to it.</li>
          <li>If you click Browse, a system folder picker opens. Navigate to the project folder and confirm.</li>
        </ol>
        <div className="help-tip">After setting the root path, click <strong>Detect metadata</strong> (top-right of the form). Code Vault will scan the folder and auto-fill the title, description, type, tags, stack, and preview images for you.</div>

        <h4>Step 3: Set the entry file (optional)</h4>
        <p>The <strong>Entry file path</strong> points to one specific file inside the project (like <code>index.html</code> or <code>main.py</code>). This is optional.</p>
        <ol>
          <li>Find the <strong>Entry file path</strong> field.</li>
          <li>Type the path or click <strong>Browse</strong> to pick the file.</li>
        </ol>

        <h4>Step 4: Fill in the details</h4>
        <table>
          <thead><tr><th>Field</th><th>What it's for</th><th>Required?</th></tr></thead>
          <tbody>
            <tr><td>Title</td><td>The name shown on the card</td><td>Yes</td></tr>
            <tr><td>Description</td><td>A short summary of what the project does</td><td>No</td></tr>
            <tr><td>Type</td><td>Categorize as snippet, mini-app, component, etc.</td><td>Yes (defaults to "snippet")</td></tr>
            <tr><td>Status</td><td>How finished: draft, usable, polished, etc.</td><td>Yes (defaults to "draft")</td></tr>
            <tr><td>Tags</td><td>Comma-separated labels for searching later</td><td>No</td></tr>
            <tr><td>Stack / language</td><td>Tech used (e.g. "React, TypeScript")</td><td>No</td></tr>
            <tr><td>Run command</td><td>Terminal command to start the project</td><td>No</td></tr>
            <tr><td>Good for</td><td>Use cases this project is good for</td><td>No</td></tr>
            <tr><td>Setup notes</td><td>Instructions to get it running</td><td>No</td></tr>
            <tr><td>Dependency notes</td><td>Notes about packages or requirements</td><td>No</td></tr>
            <tr><td>Notes</td><td>Free-form notes in Markdown</td><td>No</td></tr>
          </tbody>
        </table>

        <h4>Step 5: Attach preview images (optional)</h4>
        <ol>
          <li>Scroll to the <strong>Preview gallery</strong> section in the form.</li>
          <li>Click <strong>Attach preview</strong>.</li>
          <li>Pick an image file from your computer.</li>
          <li>Repeat to add more. The first image becomes the primary preview on the card.</li>
          <li>Use <strong>Left</strong> / <strong>Right</strong> to reorder. Use <strong>Remove</strong> to delete one.</li>
        </ol>

        <h4>Step 6: Save</h4>
        <p>Click <strong>Save entry</strong> at the bottom of the form. Your new entry appears in the main grid and the form closes.</p>
      </>
    )
  },
  {
    id: 'editing',
    title: 'Editing an Entry',
    category: 'start',
    content: (
      <>
        <p>There are two ways to edit: the <strong>full form</strong> (all fields) or <strong>Quick Edit</strong> (5 common fields).</p>

        <h4>Using the full Edit form</h4>
        <ol>
          <li>Click an entry card in the main area to select it.</li>
          <li>In the right detail panel, click the <strong>Edit</strong> button in the header.</li>
          <li>The same form from creation opens, pre-filled with the current values.</li>
          <li>Change whatever you need.</li>
          <li>Click <strong>Update entry</strong> to save.</li>
        </ol>

        <h4>Using Quick Edit</h4>
        <p>Quick Edit lets you change the 5 most common fields without opening the full form.</p>
        <ol>
          <li>Select an entry by clicking its card.</li>
          <li>In the right detail panel, click the <strong>Quick edit</strong> accordion to expand it.</li>
          <li>Edit any of these fields: <strong>Title</strong>, <strong>Status</strong>, <strong>Description</strong>, <strong>Stack</strong>, <strong>Tags</strong>.</li>
          <li>Click the <strong>Save</strong> button inside the accordion header to persist your changes.</li>
        </ol>
        <div className="help-note">Fields like Good for, Setup notes, Dependency notes, and Markdown notes are only available in the full Edit form.</div>
      </>
    )
  },
  {
    id: 'delete-archive',
    title: 'Deleting & Archiving',
    category: 'manage',
    content: (
      <>
        <h4>Deleting an entry</h4>
        <ol>
          <li>Select the entry by clicking its card.</li>
          <li>Scroll to the bottom of the right detail panel.</li>
          <li>In the <strong>danger zone</strong> (above the footer), click <strong>Delete</strong>.</li>
          <li>A confirmation dialog appears. Click OK to confirm.</li>
        </ol>
        <div className="help-note">This removes the entry from the vault database. Your actual project files on disk are <strong>not</strong> deleted.</div>

        <h4>Archiving an entry</h4>
        <p>Archiving hides an entry from the default view without deleting it.</p>
        <ol>
          <li>Select the entry.</li>
          <li>In the danger zone at the bottom of the detail panel, click <strong>Archive</strong>.</li>
          <li>Confirm the dialog.</li>
        </ol>
        <p>The entry disappears from the main view. To see it again, check <strong>Include archived</strong> in the Quick Filters panel on the left sidebar.</p>
      </>
    )
  },
  {
    id: 'fav-pin',
    title: 'Favoriting & Pinning',
    category: 'manage',
    content: (
      <>
        <h4>Favorite an entry</h4>
        <p>Favorites help you mark entries you use often.</p>
        <ul>
          <li><strong>From the card:</strong> Click the <strong>star</strong> icon below the card.</li>
          <li><strong>From the detail panel:</strong> Click the <strong>Favorite</strong> button in the header.</li>
        </ul>
        <p>The star icon turns gold when active. Click again to unfavorite.</p>

        <h4>Pin an entry</h4>
        <p>Pinned entries appear in a dedicated section at the top of the main area.</p>
        <ul>
          <li><strong>From the card:</strong> Click the <strong>pin</strong> icon below the card.</li>
          <li><strong>From the detail panel:</strong> Click the <strong>Pin</strong> button in the header.</li>
        </ul>
        <p>Click again to unpin.</p>

        <h4>Filtering</h4>
        <p>In the left sidebar under Quick Filters, check <strong>Favorites only</strong> or <strong>Pinned only</strong> to narrow the view.</p>
      </>
    )
  },
  {
    id: 'templates',
    title: 'Templates & Duplication',
    category: 'manage',
    content: (
      <>
        <h4>Marking an entry as a template</h4>
        <p>Templates are entries you can duplicate to start new projects from.</p>
        <ol>
          <li>Select the entry.</li>
          <li>In the danger zone at the bottom of the detail panel, click <strong>Mark template</strong>.</li>
        </ol>
        <p>Click <strong>Unset template</strong> to remove the badge. When an entry is a template, a <strong>Template duplication</strong> accordion appears in the detail panel.</p>

        <h4>Duplicating a template</h4>
        <ol>
          <li>Select a template entry (must have the template badge).</li>
          <li>Open the <strong>Template duplication</strong> accordion.</li>
          <li>Enter a <strong>New project name</strong>.</li>
          <li>Set a <strong>Destination parent folder</strong> by typing a path or clicking <strong>Browse</strong>.</li>
          <li>Click <strong>Create duplicate</strong>.</li>
        </ol>
        <p>Code Vault copies the project files to the new location and creates a new vault entry pointing to the copy.</p>
      </>
    )
  },
  {
    id: 'run-command',
    title: 'Running Commands',
    category: 'manage',
    content: (
      <>
        <p>If an entry has a saved run command (like <code>npm run dev</code>):</p>
        <ol>
          <li>Select the entry.</li>
          <li>Open the <strong>Quick actions</strong> accordion.</li>
          <li>Click <strong>Run command</strong>.</li>
          <li>A confirmation dialog shows the command and the directory it will run from.</li>
          <li>Click OK to run it.</li>
        </ol>
        <div className="help-note">The Run command button is disabled if no command is saved. To add one, use the full Edit form and fill in the <strong>Run command</strong> field.</div>
      </>
    )
  },
  {
    id: 'previews',
    title: 'Preview Images',
    category: 'media',
    content: (
      <>
        <p>Preview images are the pictures shown on entry cards and at the top of the detail panel.</p>

        <h4>Adding a preview image</h4>
        <p><strong>Option A — Hover controls:</strong> Select the entry, hover over the large preview image at the top of the detail panel, and click the <strong>+</strong> button in the floating toolbar.</p>
        <p><strong>Option B — Gallery accordion:</strong> Open the <strong>Preview gallery</strong> accordion and click <strong>Add preview</strong>.</p>
        <p><strong>Option C — Edit form:</strong> Open the full Edit form, scroll to <strong>Preview gallery</strong>, and click <strong>Attach preview</strong>.</p>

        <h4>Changing which preview is shown</h4>
        <p>Click any thumbnail in the <strong>Preview gallery</strong> accordion to select it. The large image updates immediately.</p>

        <h4>Reordering previews</h4>
        <ol>
          <li>Open the <strong>Preview gallery</strong> accordion.</li>
          <li>Select a thumbnail.</li>
          <li>Click <strong>Move left</strong> or <strong>Move right</strong> to change its position.</li>
        </ol>
        <p>The first image is always the primary preview shown on cards.</p>

        <h4>Removing a preview</h4>
        <p><strong>Option A:</strong> Hover over the large preview image and click the <strong>trash</strong> icon.</p>
        <p><strong>Option B:</strong> Open the <strong>Preview gallery</strong> accordion, select a thumbnail, and click <strong>Remove</strong>.</p>
      </>
    )
  },
  {
    id: 'file-preview',
    title: 'File Preview',
    category: 'media',
    content: (
      <>
        <p>Code Vault can show a quick text preview of files inside an entry's folder.</p>
        <ol>
          <li>Select the entry.</li>
          <li>Open the <strong>File preview</strong> accordion.</li>
          <li>The chip on the right shows how many previewable files were detected.</li>
          <li>Use the <strong>Preview file</strong> dropdown to switch between files.</li>
          <li>The file content appears in a dark code block below.</li>
        </ol>
        <div className="help-note">Only plain-text files are previewable. Binary files (images, compiled code) won't show content.</div>
      </>
    )
  },
  {
    id: 'search-filter',
    title: 'Searching & Filtering',
    category: 'browse',
    content: (
      <>
        <p>All filter controls are in the <strong>Filters</strong> panel in the left sidebar.</p>
        <table>
          <thead><tr><th>Control</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td>Search input</td><td>Filters by title, tags, or stack. Results update live as you type.</td></tr>
            <tr><td>Type dropdown</td><td>Show only a specific type (snippet, component, etc.), or "All types".</td></tr>
            <tr><td>Status dropdown</td><td>Show only a specific status (draft, polished, etc.), or "All statuses".</td></tr>
            <tr><td>Sort dropdown</td><td>Change the order: by last updated, created date, title, or last viewed.</td></tr>
            <tr><td>Include archived</td><td>When checked, archived entries appear in results.</td></tr>
            <tr><td>Favorites only</td><td>Show only entries marked as favorite.</td></tr>
            <tr><td>Pinned only</td><td>Show only pinned entries.</td></tr>
            <tr><td>Templates only</td><td>Show only entries marked as templates.</td></tr>
          </tbody>
        </table>
        <p>Click the <strong>Refresh</strong> icon next to the Filters heading to reload the list manually. Click <strong>Reset</strong> to clear all filters back to defaults.</p>
      </>
    )
  },
  {
    id: 'views-themes',
    title: 'Views & Themes',
    category: 'browse',
    content: (
      <>
        <h4>Switching between grid and list view</h4>
        <p>In the toolbar above the entry cards, there are two icon buttons:</p>
        <ul>
          <li><strong>Grid icon</strong> (four squares) — Cards in a multi-column grid with large preview images.</li>
          <li><strong>List icon</strong> (horizontal lines) — Cards in a single column with small square thumbnails. Favorite and pin icons appear when you hover over a row.</li>
        </ul>

        <h4>Switching between light and dark mode</h4>
        <p>Click the <strong>theme toggle</strong> button in the top-right of the main area (next to the New entry button). Your choice is saved and persists across sessions.</p>
      </>
    )
  },
  {
    id: 'resizing',
    title: 'Resizing Panels',
    category: 'browse',
    content: (
      <>
        <p>You can drag the borders between the three columns to resize them.</p>
        <ul>
          <li><strong>Left border</strong> (between sidebar and main area): Drag left or right. Range: 180px to 400px.</li>
          <li><strong>Right border</strong> (between main area and detail panel): Drag left or right. Range: 220px to 500px.</li>
        </ul>
        <p>The resize handle highlights when you hover over it.</p>
      </>
    )
  },
  {
    id: 'importing',
    title: 'Importing Projects',
    category: 'io',
    content: (
      <>
        <h4>Importing a single project</h4>
        <ol>
          <li>In the left sidebar, click <strong>Import</strong> (opens in the dock panel at the bottom of the workspace).</li>
          <li>Choose <strong>Import folder</strong> or <strong>Import file</strong>.</li>
          <li>A file picker opens. Select the folder or file.</li>
          <li>Code Vault scans it and shows an <strong>import review screen</strong> in the main area.</li>
          <li>Review the detected metadata. You can edit any field.</li>
          <li>The default decision is <strong>Keep</strong>. Click <strong>Skip</strong> if you don't want to import it.</li>
          <li>Click <strong>Save 1 accepted import</strong> to add it to the vault.</li>
        </ol>

        <h4>Batch importing multiple projects</h4>
        <ol>
          <li>Click <strong>Import</strong> in the left sidebar (opens in the dock panel).</li>
          <li>Click <strong>Batch import folder</strong>.</li>
          <li>Pick the parent folder (e.g. <code>~/Projects</code>).</li>
          <li>Code Vault scans each subfolder and shows all candidates in the review screen.</li>
          <li>For each candidate: review metadata, toggle between <strong>Keep</strong> and <strong>Skip</strong>.</li>
          <li>If a duplicate root path is detected, the candidate defaults to Skip with a warning.</li>
          <li>Click <strong>Save X accepted imports</strong> to add all kept candidates.</li>
        </ol>
      </>
    )
  },
  {
    id: 'export-bundle',
    title: 'Exporting & Bundles',
    category: 'io',
    content: (
      <>
        <h4>Export metadata only (JSON)</h4>
        <ol>
          <li>Select the entry.</li>
          <li>Click the <strong>Health &amp; Portability</strong> button in the detail panel.</li>
          <li>In the modal, click <strong>Export metadata JSON</strong>.</li>
        </ol>

        <h4>Export as a bundle (metadata + files)</h4>
        <ol>
          <li>Select the entry.</li>
          <li>Click the <strong>Health &amp; Portability</strong> button in the detail panel.</li>
          <li>In the modal, click <strong>Export entry bundle</strong>.</li>
        </ol>
        <p>This creates a portable package including metadata, source files, preview images, and relationships.</p>

        <h4>Importing an entry bundle</h4>
        <ol>
          <li>Click <strong>Portability</strong> in the left sidebar (opens in the dock panel), then click <strong>Import entry bundle</strong>. Or open the <strong>Health &amp; Portability</strong> modal on any entry and click <strong>Import entry bundle</strong>.</li>
          <li>Select the bundle file in the picker.</li>
          <li>Review the contents: title, type, preview count, source file count, warnings, duplicates.</li>
          <li>Click <strong>Import bundle</strong> to confirm, or close to cancel.</li>
        </ol>
      </>
    )
  },
  {
    id: 'backup-restore',
    title: 'Backup & Restore',
    category: 'io',
    content: (
      <>
        <h4>What is Portability?</h4>
        <p>Portability is the set of tools for moving entries between machines or creating backups. It includes exporting individual entry bundles, creating full vault backups, and restoring them. You can access it from the <strong>Portability</strong> button in the sidebar (opens in the dock panel) or from the <strong>Health &amp; Portability</strong> modal on any entry.</p>

        <h4>Backing up the vault</h4>
        <p>Creates a complete backup of every entry, relationship, and preview image.</p>
        <ol>
          <li>Click <strong>Portability</strong> in the left sidebar (opens in the dock panel).</li>
          <li>Click <strong>Create full backup</strong>.</li>
          <li>The backup file is saved. A confirmation toast appears.</li>
        </ol>

        <h4>Restoring a vault backup</h4>
        <ol>
          <li>Click <strong>Portability</strong> in the left sidebar (opens in the dock panel).</li>
          <li>Click <strong>Restore backup</strong>.</li>
          <li>Select the backup file in the picker.</li>
          <li>Review the contents: entry count, relationship count, preview count, warnings, duplicates.</li>
          <li>Click <strong>Restore backup</strong> to confirm.</li>
        </ol>
      </>
    )
  },
  {
    id: 'relationships',
    title: 'Relationships',
    category: 'connect',
    content: (
      <>
        <p>Relationships link two entries together (e.g. "this component is used-in that app").</p>

        <h4>Creating a relationship</h4>
        <ol>
          <li>Select the source entry by clicking its card.</li>
          <li>Open the <strong>Related items</strong> accordion in the detail panel.</li>
          <li>At the bottom, use the two dropdowns:
            <ul>
              <li><strong>Relationship type</strong>: How they're related (used-in, derived-from, variant-of, pairs-well-with, same-concept).</li>
              <li><strong>Target item</strong>: The other entry.</li>
            </ul>
          </li>
          <li>Click <strong>Add relationship</strong>.</li>
        </ol>

        <h4>Removing a relationship</h4>
        <ol>
          <li>Select the entry.</li>
          <li>Open the <strong>Related items</strong> accordion.</li>
          <li>Click the <strong>Remove</strong> button next to the relationship.</li>
        </ol>
      </>
    )
  },
  {
    id: 'repair',
    title: 'Fixing Broken Paths',
    category: 'connect',
    content: (
      <>
        <p>If you move a project folder, Code Vault marks the entry's paths as broken (shown as a "broken" chip on the card).</p>

        <h4>What is path health?</h4>
        <p>Path health tells you whether the project files an entry points to still exist on disk. If you moved a project folder, Code Vault marks the entry as broken (shown as a "broken" chip on the card). The Health &amp; Portability modal shows exactly what's missing.</p>

        <h4>Relinking one entry</h4>
        <ol>
          <li>Select the entry with broken paths.</li>
          <li>Click the <strong>Health &amp; Portability</strong> button in the detail panel. The summary chip shows what's wrong.</li>
          <li>In the modal, click <strong>Relink root</strong> and pick the new folder location.</li>
          <li>If the entry file is also missing, click <strong>Relink entry file</strong> and pick the new file.</li>
          <li>For each missing preview, click <strong>Replace</strong> and pick a replacement image.</li>
        </ol>

        <h4>What is Bulk Repair?</h4>
        <p>Bulk Repair is a tool for fixing many broken paths at once. If you moved a whole batch of projects from one folder to another (e.g. you renamed <code>/old/projects/</code> to <code>/new/projects/</code>), Bulk Repair can update every matching path across all entries in one go instead of relinking them one by one.</p>

        <h4>Using Bulk Repair</h4>
        <ol>
          <li>Click <strong>Bulk Repair</strong> in the left sidebar (opens in the dock panel).</li>
          <li>Enter the <strong>Old prefix</strong> (the path fragment to find).</li>
          <li>Enter the <strong>New prefix</strong> (what to replace it with).</li>
          <li>Click <strong>Run bulk repair</strong>.</li>
        </ol>
        <p>Code Vault updates every matching root path, entry file path, and preview image path across all entries.</p>
      </>
    )
  },
  {
    id: 'entry-types',
    title: 'Entry Types',
    category: 'ref',
    content: (
      <table>
        <thead><tr><th>Type</th><th>Use it for</th></tr></thead>
        <tbody>
          <tr><td><code>snippet</code></td><td>Small reusable code fragments</td></tr>
          <tr><td><code>mini-app</code></td><td>Small standalone applications</td></tr>
          <tr><td><code>mobile-app</code></td><td>Mobile applications (React Native, Flutter, etc.)</td></tr>
          <tr><td><code>web-app</code></td><td>Full web applications (Next.js, SvelteKit, etc.)</td></tr>
          <tr><td><code>component</code></td><td>UI components or modules</td></tr>
          <tr><td><code>utility</code></td><td>Helper functions or tools</td></tr>
          <tr><td><code>prompt-output</code></td><td>AI-generated code or prompt results</td></tr>
          <tr><td><code>template</code></td><td>Starter projects meant to be duplicated</td></tr>
          <tr><td><code>experiment</code></td><td>Exploratory or throwaway code</td></tr>
        </tbody>
      </table>
    )
  },
  {
    id: 'entry-statuses',
    title: 'Entry Statuses',
    category: 'ref',
    content: (
      <table>
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>draft</code></td><td>Work in progress, not ready for use</td></tr>
          <tr><td><code>usable</code></td><td>Functional but may need polish</td></tr>
          <tr><td><code>polished</code></td><td>Clean, documented, ready to use</td></tr>
          <tr><td><code>completed</code></td><td>Finished, no further work planned</td></tr>
          <tr><td><code>experimental</code></td><td>Trying something out, might not keep</td></tr>
          <tr><td><code>archived</code></td><td>No longer active, hidden from default view</td></tr>
        </tbody>
      </table>
    )
  },
  {
    id: 'rel-types',
    title: 'Relationship Types',
    category: 'ref',
    content: (
      <table>
        <thead><tr><th>Type</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>used-in</code></td><td>Entry A is used inside Entry B</td></tr>
          <tr><td><code>derived-from</code></td><td>Entry A was built starting from Entry B</td></tr>
          <tr><td><code>variant-of</code></td><td>Entry A is a different version of Entry B</td></tr>
          <tr><td><code>pairs-well-with</code></td><td>Entry A works well alongside Entry B</td></tr>
          <tr><td><code>same-concept</code></td><td>Entry A and Entry B explore the same idea</td></tr>
        </tbody>
      </table>
    )
  }
]

function HelpGuide({ onClose, initialSectionId }: { onClose: () => void; initialSectionId?: string }): ReactElement {
  const [activeSection, setActiveSection] = useState(initialSectionId || 'layout')
  const [searchQuery, setSearchQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const filteredFaq = useMemo(() => {
    if (!searchQuery.trim()) {
      return []
    }
    const q = searchQuery.toLowerCase()
    return faqItems.filter((item) => item.question.toLowerCase().includes(q))
  }, [searchQuery])

  const currentSection = sections.find((s) => s.id === activeSection) ?? sections[0]

  function navigateTo(sectionId: string): void {
    setActiveSection(sectionId)
    setSearchQuery('')
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="help-header">
          <button className="help-close-btn" type="button" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
          <h2>User Guide</h2>
          <span className="material-symbols-outlined help-header-icon">menu_book</span>
        </div>

        {/* Search */}
        <div className="help-search">
          <span className="material-symbols-outlined help-search-icon">search</span>
          <input
            ref={searchRef}
            className="help-search-input"
            placeholder="Search for answers..."
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button
              className="help-search-clear"
              type="button"
              onClick={() => setSearchQuery('')}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          ) : null}
        </div>

        {/* Search results dropdown */}
        {filteredFaq.length > 0 ? (
          <div className="help-search-results">
            {filteredFaq.map((item) => (
              <button
                key={item.question}
                className="help-search-result"
                type="button"
                onClick={() => navigateTo(item.sectionId)}
              >
                <span className="material-symbols-outlined">help_outline</span>
                <span>{item.question}</span>
                <span className="help-search-result-section">
                  {sections.find((s) => s.id === item.sectionId)?.title}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {searchQuery.trim() && filteredFaq.length === 0 ? (
          <div className="help-search-results">
            <div className="help-search-empty">No matching questions found.</div>
          </div>
        ) : null}

        {/* Reminder */}
        <div className="vault-reminder" style={{ margin: '10px 20px 0' }}>
          <span className="material-symbols-outlined vault-reminder-icon">info</span>
          <p>
            Code Vault saves a <strong>link</strong> to your project folder — it does not copy or move your files.
            Your project stays exactly where it is. If you set a <strong>Run command</strong>, you can launch it
            straight from the vault.
          </p>
        </div>

        {/* Body */}
        <div className="help-body">
          {/* Sidebar navigation */}
          <nav className="help-nav">
            {helpCategories.map((cat) => {
              const catSections = sections.filter((s) => s.category === cat.id)
              if (catSections.length === 0) return null
              return (
                <div key={cat.id} className="help-nav-group">
                  <p className="help-nav-label">{cat.label}</p>
                  {catSections.map((section) => (
                    <button
                      key={section.id}
                      className={`help-nav-item ${activeSection === section.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => navigateTo(section.id)}
                    >
                      {section.title}
                    </button>
                  ))}
                </div>
              )
            })}
          </nav>

          {/* Content */}
          <div className="help-content" ref={contentRef}>
            <div className="help-content-header">
              <p className="help-content-category">
                {helpCategories.find((c) => c.id === currentSection.category)?.label}
              </p>
              <h3>{currentSection.title}</h3>
            </div>
            <div className="help-content-body">
              {currentSection.content}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { HelpGuide }
