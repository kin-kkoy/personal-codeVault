import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { defaultEntryDraft, defaultFilters } from '@shared/defaults'
import { entryStatuses, entryTypes, type EntryDraft, type EntryFilters, type VaultEntry } from '@shared/types'
import { vaultApi } from './vaultApi'

type FormMode = 'create' | 'edit'

function normalizeDraft(entry?: VaultEntry | null): EntryDraft {
  if (!entry) {
    return defaultEntryDraft
  }

  return {
    title: entry.title,
    description: entry.description,
    type: entry.type,
    tags: entry.tags,
    stack: entry.stack,
    rootPath: entry.rootPath,
    entryFilePath: entry.entryFilePath,
    previewImagePath: entry.previewImagePath,
    notes: entry.notes,
    status: entry.status
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function getPreviewSrc(path: string): string {
  return convertFileSrc(path)
}

function App(): ReactElement {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<EntryFilters>(defaultFilters)
  const [draft, setDraft] = useState<EntryDraft>(defaultEntryDraft)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId]
  )

  async function refreshEntries(nextFilters: EntryFilters = filters): Promise<void> {
    setIsLoading(true)
    setError('')

    try {
      const nextEntries = await vaultApi.listEntries(nextFilters)
      setEntries(nextEntries)
      setSelectedId((current) => {
        if (current && nextEntries.some((entry) => entry.id === current)) {
          return current
        }

        return nextEntries[0]?.id ?? null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load entries.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshEntries()
  }, [])

  useEffect(() => {
    void refreshEntries(filters)
  }, [filters])

  useEffect(() => {
    if (formMode === 'edit' && selectedEntry) {
      setDraft(normalizeDraft(selectedEntry))
    }
  }, [formMode, selectedEntry])

  function resetCreateForm(): void {
    setFormMode('create')
    setDraft(defaultEntryDraft)
  }

  function startEdit(): void {
    if (!selectedEntry) {
      return
    }

    setFormMode('edit')
    setDraft(normalizeDraft(selectedEntry))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setNotice('')

    if (!draft.title.trim() || !draft.rootPath.trim()) {
      setError('Title and root path are required.')
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const payload = {
        ...draft,
        tags: draft.tags
      }

      if (formMode === 'create') {
        const created = await vaultApi.createEntry(payload)
        setSelectedId(created.id)
        resetCreateForm()
      } else if (selectedEntry) {
        const updated = await vaultApi.updateEntry(selectedEntry.id, payload)
        setSelectedId(updated.id)
      }

      await refreshEntries(filters)
      setNotice(formMode === 'create' ? 'Entry saved.' : 'Entry updated.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save entry.')
    } finally {
      setIsSaving(false)
    }
  }

  async function attachPreview(): Promise<void> {
    const result = await vaultApi.importPreviewImage()
    const previewPath = result.path
    if (!result.canceled && previewPath !== null) {
      setDraft((current) => ({ ...current, previewImagePath: previewPath }))
    }
  }

  async function pickRootPath(): Promise<void> {
    const result = await vaultApi.pickRootPath()
    const rootPath = result.path
    if (!result.canceled && rootPath !== null) {
      setDraft((current) => ({ ...current, rootPath }))
    }
  }

  async function pickEntryFile(): Promise<void> {
    const result = await vaultApi.pickEntryFile()
    const entryFilePath = result.path
    if (!result.canceled && entryFilePath !== null) {
      setDraft((current) => ({ ...current, entryFilePath }))
    }
  }

  async function handleArchive(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const confirmed = window.confirm(`Archive "${selectedEntry.title}"?`)
    if (!confirmed) {
      return
    }

    await vaultApi.archiveEntry(selectedEntry.id)
    setNotice('Entry archived.')
    resetCreateForm()
    await refreshEntries(filters)
  }

  async function handleDelete(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const confirmed = window.confirm(
      `Delete "${selectedEntry.title}" from the vault record? This will not remove project files.`
    )
    if (!confirmed) {
      return
    }

    await vaultApi.deleteEntry(selectedEntry.id)
    setNotice('Entry deleted from vault.')
    resetCreateForm()
    await refreshEntries(filters)
  }

  async function handleOpenPath(targetPath: string, label: string): Promise<void> {
    const result = await vaultApi.openPath(targetPath)
    if (!result.success) {
      setError(result.message ?? `Could not open ${label}.`)
      return
    }

    setNotice(result.message ?? `${label} opened.`)
  }

  async function handleCopy(value: string, label: string): Promise<void> {
    await vaultApi.copyToClipboard(value)
    setNotice(`${label} copied.`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Phase 1 MVP</p>
          <h1>Code Vault</h1>
          <p className="lede">
            A local visual catalog for snippets, experiments, mini-apps, and reusable code artifacts.
          </p>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <h2>Browse Vault</h2>
            <button className="ghost-button" type="button" onClick={() => void refreshEntries(filters)}>
              Refresh
            </button>
          </div>

          <label className="field">
            <span>Search title or tags</span>
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search by title or tag"
            />
          </label>

          <div className="filter-row">
            <label className="field">
              <span>Type</span>
              <select
                value={filters.type}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    type: event.target.value as EntryFilters['type']
                  }))
                }
              >
                <option value="all">All types</option>
                {entryTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Status</span>
              <select
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value as EntryFilters['status']
                  }))
                }
              >
                <option value="all">All statuses</option>
                {entryStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="checkbox-field">
            <input
              checked={filters.includeArchived}
              type="checkbox"
              onChange={(event) =>
                setFilters((current) => ({ ...current, includeArchived: event.target.checked }))
              }
            />
            <span>Include archived items</span>
          </label>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>{formMode === 'create' ? 'Add Entry' : 'Edit Entry'}</h2>
            {formMode === 'edit' ? (
              <button className="ghost-button" type="button" onClick={resetCreateForm}>
                New entry
              </button>
            ) : null}
          </div>

          <form className="entry-form" onSubmit={(event) => void handleSubmit(event)}>
            <label className="field">
              <span>Title</span>
              <input
                required
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Description</span>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>

            <div className="filter-row">
              <label className="field">
                <span>Type</span>
                <select
                  value={draft.type}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, type: event.target.value as EntryDraft['type'] }))
                  }
                >
                  {entryTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Status</span>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value as EntryDraft['status']
                    }))
                  }
                >
                  {entryStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Tags</span>
              <input
                placeholder="react, sqlite, animation"
                value={draft.tags.join(', ')}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, tags: parseTags(event.target.value) }))
                }
              />
            </label>

            <label className="field">
              <span>Stack / language</span>
              <input
                value={draft.stack}
                onChange={(event) => setDraft((current) => ({ ...current, stack: event.target.value }))}
                placeholder="React, TypeScript, GLSL"
              />
            </label>

            <label className="field">
              <span>Root path</span>
              <div className="path-input">
                <input
                  required
                  value={draft.rootPath}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, rootPath: event.target.value }))
                  }
                />
                <button className="ghost-button" type="button" onClick={() => void pickRootPath()}>
                  Browse
                </button>
              </div>
            </label>

            <label className="field">
              <span>Entry file path</span>
              <div className="path-input">
                <input
                  value={draft.entryFilePath}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, entryFilePath: event.target.value }))
                  }
                />
                <button className="ghost-button" type="button" onClick={() => void pickEntryFile()}>
                  Browse
                </button>
              </div>
            </label>

            <label className="field">
              <span>Preview image</span>
              <div className="path-input">
                <input
                  value={draft.previewImagePath}
                  readOnly
                  placeholder="Attach a screenshot or preview image"
                />
                <button className="ghost-button" type="button" onClick={() => void attachPreview()}>
                  Attach
                </button>
              </div>
            </label>

            <label className="field">
              <span>Notes</span>
              <textarea
                rows={4}
                value={draft.notes}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>

            <button className="primary-button" disabled={isSaving} type="submit">
              {isSaving ? 'Saving...' : formMode === 'create' ? 'Save entry' : 'Update entry'}
            </button>
          </form>
        </section>
      </aside>

      <main className="content">
        <section className="toolbar">
          <div>
            <p className="eyebrow">Vault overview</p>
            <h2>{entries.length} visible item{entries.length === 1 ? '' : 's'}</h2>
          </div>
          <div className="status-area">
            {error ? <p className="status-message error">{error}</p> : null}
            {!error && notice ? <p className="status-message">{notice}</p> : null}
          </div>
        </section>

        <section className="workspace">
          <div className="vault-panel">
            {isLoading ? <div className="empty-state">Loading your vault...</div> : null}

            {!isLoading && entries.length === 0 ? (
              <div className="empty-state">
                <h3>No entries yet</h3>
                <p>Add your first item to start building a visual recall library.</p>
              </div>
            ) : null}

            {!isLoading && entries.length > 0 ? (
              <div className="card-grid">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    className={`entry-card ${selectedId === entry.id ? 'selected' : ''}`}
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                  >
                    {entry.previewImagePath ? (
                      <img alt={`${entry.title} preview`} src={getPreviewSrc(entry.previewImagePath)} />
                    ) : (
                      <div className="preview-placeholder">{entry.type}</div>
                    )}

                    <div className="entry-card-body">
                      <div className="entry-card-header">
                        <h3>{entry.title}</h3>
                        <span className="chip subtle">{entry.status}</span>
                      </div>
                      <p>{entry.description || 'No description yet.'}</p>
                      <div className="chip-row">
                        <span className="chip">{entry.type}</span>
                        {entry.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="chip subtle">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <section className="detail-panel">
            {selectedEntry ? (
              <>
                <div className="detail-preview">
                  {selectedEntry.previewImagePath ? (
                    <img
                      alt={`${selectedEntry.title} preview`}
                      src={getPreviewSrc(selectedEntry.previewImagePath)}
                    />
                  ) : (
                    <div className="preview-placeholder large">{selectedEntry.type}</div>
                  )}
                </div>

                <div className="detail-header">
                  <div>
                    <p className="eyebrow">Item detail</p>
                    <h2>{selectedEntry.title}</h2>
                  </div>
                  <div className="detail-actions">
                    <button className="ghost-button" type="button" onClick={startEdit}>
                      Edit
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void handleArchive()}>
                      Archive
                    </button>
                    <button className="danger-button" type="button" onClick={() => void handleDelete()}>
                      Delete
                    </button>
                  </div>
                </div>

                <p className="detail-description">
                  {selectedEntry.description || 'No description saved for this entry yet.'}
                </p>

                <div className="chip-row">
                  <span className="chip">{selectedEntry.type}</span>
                  <span className="chip">{selectedEntry.status}</span>
                  {selectedEntry.stack ? <span className="chip">{selectedEntry.stack}</span> : null}
                  {selectedEntry.tags.map((tag) => (
                    <span key={tag} className="chip subtle">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="detail-meta">
                  <div className="detail-block">
                    <h3>Paths</h3>
                    <div className="meta-line">
                      <span>Root</span>
                      <code>{selectedEntry.rootPath}</code>
                    </div>
                    {selectedEntry.entryFilePath ? (
                      <div className="meta-line">
                        <span>Entry file</span>
                        <code>{selectedEntry.entryFilePath}</code>
                      </div>
                    ) : null}
                    {selectedEntry.previewImagePath ? (
                      <div className="meta-line">
                        <span>Preview</span>
                        <code>{selectedEntry.previewImagePath}</code>
                      </div>
                    ) : null}
                  </div>

                  <div className="detail-block">
                    <h3>Quick actions</h3>
                    <div className="action-grid">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleOpenPath(selectedEntry.rootPath, 'Root path')}
                      >
                        Open root folder
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!selectedEntry.entryFilePath}
                        onClick={() => void handleOpenPath(selectedEntry.entryFilePath, 'Entry file')}
                      >
                        Open entry file
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleCopy(selectedEntry.rootPath, 'Root path')}
                      >
                        Copy root path
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!selectedEntry.entryFilePath}
                        onClick={() =>
                          void handleCopy(selectedEntry.entryFilePath, 'Entry file path')
                        }
                      >
                        Copy entry file path
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!selectedEntry.previewImagePath}
                        onClick={() =>
                          void handleOpenPath(selectedEntry.previewImagePath, 'Preview image')
                        }
                      >
                        Open preview image
                      </button>
                    </div>
                  </div>
                </div>

                <div className="detail-block">
                  <h3>Notes</h3>
                  <p className="detail-notes">{selectedEntry.notes || 'No notes saved yet.'}</p>
                </div>

                <div className="detail-footer">
                  <span>Created {formatDate(selectedEntry.createdAt)}</span>
                  <span>Updated {formatDate(selectedEntry.updatedAt)}</span>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h3>Select an item</h3>
                <p>Pick an entry to inspect its preview, metadata, and quick actions.</p>
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  )
}

export { App }
