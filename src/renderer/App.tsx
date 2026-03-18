import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { defaultEntryDraft, defaultFilters } from '@shared/defaults'
import {
  entryStatuses,
  entryTypes,
  relationshipTypes,
  sortOptions,
  type DuplicateInspection,
  type EntryBundleInspection,
  type EntryDraft,
  type EntryFilters,
  type EntryOption,
  type EntryRelationship,
  type ImportCandidate,
  type PathHealth,
  type PreviewImage,
  type PreviewableFile,
  type QuickFilePreview,
  type QuickPreviewInspection,
  type RecentActivity,
  type RelationshipType,
  type VaultBackupInspection,
  type VaultEntry,
  type VaultEntryInput
} from '@shared/types'
import { vaultApi } from './vaultApi'

type FormMode = 'create' | 'edit'
type ImportDecision = 'keep' | 'skip'

type RelationshipDraft = {
  targetEntryId: string
  relationshipType: RelationshipType
}

type DuplicateDraft = {
  newProjectName: string
  destinationParentPath: string
}

type BulkRepairDraft = {
  oldPrefix: string
  newPrefix: string
}

type InlineDraft = {
  title: string
  description: string
  tags: string[]
  stack: string
  status: EntryDraft['status']
  notes: string
  goodFor: string
  setupNotes: string
  dependencyNotes: string
}

type ImportCandidateState = ImportCandidate & {
  decision: ImportDecision
  activePreviewPath: string
  quickPreview: QuickFilePreview | null
  importError: string
}

function withPreviewOrdering(images: PreviewImage[]): PreviewImage[] {
  return images.map((image, index) => ({
    ...image,
    order: index,
    isMissing: Boolean(image.path) && Boolean(image.isMissing)
  }))
}

function syncPreviewPath<T extends { previewImages: PreviewImage[]; previewImagePath: string }>(
  value: T
): T {
  const previewImages = withPreviewOrdering(value.previewImages)
  return {
    ...value,
    previewImages,
    previewImagePath: previewImages[0]?.path ?? ''
  }
}

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
    previewImages: entry.previewImages,
    isFavorite: entry.isFavorite,
    isPinned: entry.isPinned,
    isTemplate: entry.isTemplate,
    notes: entry.notes,
    goodFor: entry.goodFor,
    setupNotes: entry.setupNotes,
    dependencyNotes: entry.dependencyNotes,
    runCommand: entry.runCommand,
    status: entry.status
  }
}

function toEntryInput(entry: EntryDraft | VaultEntry | ImportCandidate): VaultEntryInput {
  const previewImages = withPreviewOrdering(entry.previewImages)

  return {
    title: entry.title,
    description: entry.description,
    type: entry.type,
    tags: entry.tags,
    stack: entry.stack,
    rootPath: entry.rootPath,
    entryFilePath: entry.entryFilePath,
    previewImagePath: previewImages[0]?.path ?? entry.previewImagePath ?? '',
    previewImages,
    isFavorite: entry.isFavorite,
    isPinned: entry.isPinned,
    isTemplate: entry.isTemplate,
    notes: entry.notes,
    goodFor: entry.goodFor,
    setupNotes: entry.setupNotes,
    dependencyNotes: entry.dependencyNotes,
    runCommand: entry.runCommand,
    status: entry.status
  }
}

function getImportCandidateInput(candidate: ImportCandidateState): ImportCandidate {
  return {
    ...candidate,
    ...toEntryInput(candidate)
  }
}

function toInlineDraft(entry: VaultEntry | null): InlineDraft {
  return {
    title: entry?.title ?? '',
    description: entry?.description ?? '',
    tags: entry?.tags ?? [],
    stack: entry?.stack ?? '',
    status: entry?.status ?? 'draft',
    notes: entry?.notes ?? '',
    goodFor: entry?.goodFor ?? '',
    setupNotes: entry?.setupNotes ?? '',
    dependencyNotes: entry?.dependencyNotes ?? ''
  }
}

function formatDate(value: string): string {
  if (!value) {
    return 'Never'
  }

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

function getRelationshipLabel(value: RelationshipType): string {
  return value.replaceAll('-', ' ')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function renderMarkdown(value: string): string {
  const escaped = escapeHtml(value)
  const lines = escaped.split('\n')
  const output: string[] = []
  let inList = false
  let inCode = false
  let paragraph: string[] = []

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      output.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }

  function closeList(): void {
    if (inList) {
      output.push('</ul>')
      inList = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    if (line.startsWith('```')) {
      flushParagraph()
      closeList()
      if (inCode) {
        output.push('</code></pre>')
        inCode = false
      } else {
        output.push('<pre><code>')
        inCode = true
      }
      continue
    }

    if (inCode) {
      output.push(`${line}\n`)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      closeList()
      continue
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph()
      closeList()
      output.push(`<h4>${renderInlineMarkdown(trimmed.slice(2))}</h4>`)
      continue
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph()
      closeList()
      output.push(`<h5>${renderInlineMarkdown(trimmed.slice(3))}</h5>`)
      continue
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph()
      if (!inList) {
        output.push('<ul>')
        inList = true
      }
      output.push(`<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`)
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  closeList()

  if (inCode) {
    output.push('</code></pre>')
  }

  return output.join('')
}

function App(): ReactElement {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<EntryFilters>(defaultFilters)
  const [draft, setDraft] = useState<EntryDraft>(defaultEntryDraft)
  const [inlineDraft, setInlineDraft] = useState<InlineDraft>(toInlineDraft(null))
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSavingInline, setIsSavingInline] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isCreatingRelationship, setIsCreatingRelationship] = useState(false)
  const [isDetectingMetadata, setIsDetectingMetadata] = useState(false)
  const [isScanningImport, setIsScanningImport] = useState(false)
  const [isSavingImports, setIsSavingImports] = useState(false)
  const [isRunningCommand, setIsRunningCommand] = useState(false)
  const [isBulkRepairing, setIsBulkRepairing] = useState(false)
  const [isManagingPreviews, setIsManagingPreviews] = useState(false)
  const [isPortabilityBusy, setIsPortabilityBusy] = useState(false)
  const [error, setError] = useState<string>('')
  const [notice, setNotice] = useState<string>('')
  const [lastPortabilityResult, setLastPortabilityResult] = useState<string>('')
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [entryOptions, setEntryOptions] = useState<EntryOption[]>([])
  const [relationships, setRelationships] = useState<EntryRelationship[]>([])
  const [recentActivity, setRecentActivity] = useState<RecentActivity | null>(null)
  const [duplicateInspection, setDuplicateInspection] = useState<DuplicateInspection>({ matches: [] })
  const [pathHealth, setPathHealth] = useState<PathHealth | null>(null)
  const [entryBundleInspection, setEntryBundleInspection] = useState<EntryBundleInspection | null>(null)
  const [vaultBackupInspection, setVaultBackupInspection] = useState<VaultBackupInspection | null>(null)
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null)
  const [relationshipDraft, setRelationshipDraft] = useState<RelationshipDraft>({
    targetEntryId: '',
    relationshipType: relationshipTypes[0]
  })
  const [showDuplicateTemplate, setShowDuplicateTemplate] = useState(false)
  const [duplicateDraft, setDuplicateDraft] = useState<DuplicateDraft>({
    newProjectName: '',
    destinationParentPath: ''
  })
  const [bulkRepairDraft, setBulkRepairDraft] = useState<BulkRepairDraft>({
    oldPrefix: '',
    newPrefix: ''
  })
  const [importCandidates, setImportCandidates] = useState<ImportCandidateState[]>([])
  const [detailPreviewInspection, setDetailPreviewInspection] =
    useState<QuickPreviewInspection | null>(null)
  const [detailPreviewPath, setDetailPreviewPath] = useState('')
  const [detailPreview, setDetailPreview] = useState<QuickFilePreview | null>(null)

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId]
  )

  const selectedPreview = useMemo(() => {
    if (!selectedEntry) {
      return null
    }

    return (
      selectedEntry.previewImages.find((image) => image.id === selectedPreviewId) ??
      selectedEntry.previewImages[0] ??
      null
    )
  }, [selectedEntry, selectedPreviewId])

  const pinnedEntries = useMemo(() => entries.filter((entry) => entry.isPinned), [entries])

  const relatedTargetOptions = useMemo(
    () => entryOptions.filter((entry) => entry.id !== selectedId),
    [entryOptions, selectedId]
  )

  const suggestedTags = useMemo(
    () => tagSuggestions.filter((tag) => !draft.tags.includes(tag)).slice(0, 8),
    [draft.tags, tagSuggestions]
  )

  const acceptedImportCount = useMemo(
    () => importCandidates.filter((candidate) => candidate.decision === 'keep').length,
    [importCandidates]
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

  async function refreshReferenceData(): Promise<void> {
    try {
      const [nextTags, nextOptions, nextRecent] = await Promise.all([
        vaultApi.listTags(),
        vaultApi.listEntryOptions(),
        vaultApi.listRecentActivity()
      ])
      setTagSuggestions(nextTags)
      setEntryOptions(nextOptions)
      setRecentActivity(nextRecent)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load vault metadata.')
    }
  }

  async function refreshRelationships(entryId: string | null): Promise<void> {
    if (!entryId) {
      setRelationships([])
      return
    }

    try {
      const nextRelationships = await vaultApi.listRelationships(entryId)
      setRelationships(nextRelationships)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load related items.')
    }
  }

  async function refreshDiagnostics(entryId: string | null): Promise<void> {
    if (!entryId) {
      setDuplicateInspection({ matches: [] })
      setPathHealth(null)
      return
    }

    try {
      const [duplicates, health] = await Promise.all([
        vaultApi.inspectDuplicates(entryId),
        vaultApi.inspectPathHealth(entryId)
      ])
      setDuplicateInspection(duplicates)
      setPathHealth(health)
    } catch (diagnosticError) {
      setError(
        diagnosticError instanceof Error
          ? diagnosticError.message
          : 'Failed to inspect duplicates or path health.'
      )
    }
  }

  async function loadQuickPreview(targetPath: string, rootPath: string): Promise<QuickFilePreview | null> {
    if (!targetPath) {
      return null
    }

    try {
      return await vaultApi.readQuickPreview(targetPath, rootPath)
    } catch (previewError) {
      return {
        path: targetPath,
        relativePath: targetPath,
        content: '',
        truncated: false,
        message:
          previewError instanceof Error
            ? previewError.message
            : 'The quick preview could not be loaded.'
      }
    }
  }

  async function hydrateImportCandidates(candidates: ImportCandidate[]): Promise<ImportCandidateState[]> {
    const baseCandidates = candidates.map((candidate) =>
      syncPreviewPath({
        ...candidate,
        previewImages: candidate.previewImages,
        decision: (candidate.duplicateRootPath ? 'skip' : 'keep') as ImportDecision,
        activePreviewPath: candidate.defaultPreviewPath,
        quickPreview: null,
        importError: ''
      })
    )

    const previews = await Promise.all(
      baseCandidates.map(async (candidate) => ({
        tempId: candidate.tempId,
        quickPreview: await loadQuickPreview(
          candidate.activePreviewPath || candidate.defaultPreviewPath,
          candidate.rootPath
        )
      }))
    )

    return baseCandidates.map((candidate) => ({
      ...candidate,
      quickPreview:
        previews.find((preview) => preview.tempId === candidate.tempId)?.quickPreview ?? null
    }))
  }

  async function refreshDetailQuickPreview(entry: VaultEntry | null): Promise<void> {
    if (!entry) {
      setDetailPreviewInspection(null)
      setDetailPreviewPath('')
      setDetailPreview(null)
      return
    }

    try {
      const inspection = await vaultApi.inspectQuickPreview(entry.rootPath, entry.entryFilePath)
      setDetailPreviewInspection(inspection)
      const nextPath = inspection.defaultPreviewPath
      setDetailPreviewPath(nextPath)
      setDetailPreview(await loadQuickPreview(nextPath, entry.rootPath))
    } catch (previewError) {
      setDetailPreviewInspection(null)
      setDetailPreviewPath('')
      setDetailPreview({
        path: '',
        relativePath: '',
        content: '',
        truncated: false,
        message:
          previewError instanceof Error
            ? previewError.message
            : 'Quick preview is not available for this entry.'
      })
    }
  }

  useEffect(() => {
    void refreshEntries()
    void refreshReferenceData()
  }, [])

  useEffect(() => {
    void refreshEntries(filters)
  }, [filters])

  useEffect(() => {
    if (formMode === 'edit' && selectedEntry) {
      setDraft(normalizeDraft(selectedEntry))
    }
  }, [formMode, selectedEntry])

  useEffect(() => {
    void refreshRelationships(selectedEntry?.id ?? null)
    void refreshDiagnostics(selectedEntry?.id ?? null)
    void refreshDetailQuickPreview(selectedEntry)

    if (!selectedEntry) {
      setShowDuplicateTemplate(false)
      setDuplicateDraft({
        newProjectName: '',
        destinationParentPath: ''
      })
      setInlineDraft(toInlineDraft(null))
      setSelectedPreviewId(null)
      setRelationshipDraft({
        targetEntryId: '',
        relationshipType: relationshipTypes[0]
      })
      return
    }

    setSelectedPreviewId(selectedEntry.previewImages[0]?.id ?? null)
    setInlineDraft(toInlineDraft(selectedEntry))
    setDuplicateDraft({
      newProjectName: `${selectedEntry.title} Copy`,
      destinationParentPath: ''
    })
    setRelationshipDraft((current) => ({
      ...current,
      targetEntryId: ''
    }))

    void vaultApi.markEntryViewed(selectedEntry.id).then(() => {
      void refreshReferenceData()
      if (filters.sortBy === 'viewed') {
        void refreshEntries(filters)
      }
    })
  }, [selectedEntry?.id])

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

  function updateDraft(nextDraft: EntryDraft): void {
    setDraft(syncPreviewPath(nextDraft))
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
      if (formMode === 'create') {
        const created = await vaultApi.createEntry(toEntryInput(draft))
        setSelectedId(created.id)
        resetCreateForm()
      } else if (selectedEntry) {
        const updated = await vaultApi.updateEntry(selectedEntry.id, toEntryInput(draft))
        setSelectedId(updated.id)
      }

      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice(formMode === 'create' ? 'Entry saved.' : 'Entry updated.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save entry.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveInline(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    setIsSavingInline(true)
    setError('')

    try {
      const updated = await vaultApi.patchEntry(selectedEntry.id, {
        title: inlineDraft.title,
        description: inlineDraft.description,
        tags: inlineDraft.tags,
        stack: inlineDraft.stack,
        status: inlineDraft.status,
        notes: inlineDraft.notes,
        goodFor: inlineDraft.goodFor,
        setupNotes: inlineDraft.setupNotes,
        dependencyNotes: inlineDraft.dependencyNotes
      })
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Quick changes saved.')
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : 'Failed to save inline changes.')
    } finally {
      setIsSavingInline(false)
    }
  }

  async function attachPreviewToDraft(): Promise<void> {
    const result = await vaultApi.importPreviewImage()
    if (result.canceled || !result.path) {
      return
    }

    updateDraft({
      ...draft,
      previewImages: [
        ...draft.previewImages,
        {
          id: crypto.randomUUID(),
          path: result.path,
          order: draft.previewImages.length,
          createdAt: new Date().toISOString(),
          isMissing: false
        }
      ]
    })
  }

  function moveDraftPreview(previewId: string, direction: 'left' | 'right'): void {
    const previewImages = [...draft.previewImages]
    const index = previewImages.findIndex((image) => image.id === previewId)
    if (index === -1) {
      return
    }
    const targetIndex = direction === 'left' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= previewImages.length) {
      return
    }
    ;[previewImages[index], previewImages[targetIndex]] = [previewImages[targetIndex], previewImages[index]]
    updateDraft({
      ...draft,
      previewImages
    })
  }

  function removeDraftPreview(previewId: string): void {
    updateDraft({
      ...draft,
      previewImages: draft.previewImages.filter((image) => image.id !== previewId)
    })
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

  async function pickDuplicateDestination(): Promise<void> {
    const result = await vaultApi.pickRootPath()
    const rootPath = result.path
    if (!result.canceled && rootPath !== null) {
      setDuplicateDraft((current) => ({ ...current, destinationParentPath: rootPath }))
    }
  }

  async function handleRefreshMetadata(): Promise<void> {
    if (!draft.rootPath.trim() && !draft.entryFilePath.trim()) {
      setError('Choose a root path or entry file before detecting metadata.')
      return
    }

    setIsDetectingMetadata(true)
    setError('')

    try {
      const suggestion = await vaultApi.refreshMetadata(draft.rootPath, draft.entryFilePath)
      updateDraft({
        ...draft,
        title: suggestion.title || draft.title,
        description: suggestion.description || draft.description,
        type: suggestion.type,
        tags: suggestion.tags.length > 0 ? suggestion.tags : draft.tags,
        stack: suggestion.stack || draft.stack,
        rootPath: suggestion.rootPath || draft.rootPath,
        entryFilePath: suggestion.entryFilePath || draft.entryFilePath,
        previewImages: suggestion.previewImages.length > 0 ? suggestion.previewImages : draft.previewImages,
        runCommand: suggestion.runCommand || draft.runCommand
      })
      setNotice('Detected metadata applied to the form.')
    } catch (metadataError) {
      setError(
        metadataError instanceof Error
          ? metadataError.message
          : 'Failed to detect metadata from disk.'
      )
    } finally {
      setIsDetectingMetadata(false)
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
    await Promise.all([refreshEntries(filters), refreshReferenceData()])
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
    await Promise.all([refreshEntries(filters), refreshReferenceData()])
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

  async function handleRunCommand(): Promise<void> {
    if (!selectedEntry?.runCommand) {
      setError('No run command is saved for this entry.')
      return
    }

    const confirmed = window.confirm(
      `Run "${selectedEntry.runCommand}" from:\n${selectedEntry.rootPath}`
    )
    if (!confirmed) {
      return
    }

    setIsRunningCommand(true)
    setError('')

    try {
      const result = await vaultApi.runEntryCommand(selectedEntry.rootPath, selectedEntry.runCommand)
      if (!result.success) {
        setError(result.message ?? 'The run command could not be started.')
        return
      }
      setNotice(result.message ?? 'Run command started.')
    } finally {
      setIsRunningCommand(false)
    }
  }

  function summarizePortabilityResult(message: string, warnings: string[]): string {
    return warnings.length > 0 ? `${message} ${warnings.length} warning(s).` : message
  }

  async function handleExportEntryMetadata(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    setIsPortabilityBusy(true)
    setError('')

    try {
      const result = await vaultApi.exportEntryMetadata(selectedEntry.id)
      const summary = summarizePortabilityResult(result.message, result.warnings)
      setLastPortabilityResult(summary)
      setNotice(summary)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export metadata.')
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleExportEntryBundle(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    setIsPortabilityBusy(true)
    setError('')

    try {
      const result = await vaultApi.exportEntryBundle(selectedEntry.id)
      const summary = summarizePortabilityResult(result.message, result.warnings)
      setLastPortabilityResult(summary)
      setNotice(summary)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export entry bundle.')
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleInspectEntryBundle(): Promise<void> {
    setIsPortabilityBusy(true)
    setError('')

    try {
      const inspection = await vaultApi.inspectEntryBundle()
      setVaultBackupInspection(null)
      setEntryBundleInspection(inspection)
      if (inspection) {
        setNotice('Entry bundle ready for review.')
      }
    } catch (inspectionError) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : 'Failed to inspect the entry bundle.'
      )
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleImportReviewedEntryBundle(): Promise<void> {
    if (!entryBundleInspection) {
      return
    }

    setIsPortabilityBusy(true)
    setError('')

    try {
      const result = await vaultApi.importEntryBundle(entryBundleInspection.packagePath)
      if (result.importedEntryIds[0]) {
        setSelectedId(result.importedEntryIds[0])
      }
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      const summary = summarizePortabilityResult(result.message, result.warnings)
      setLastPortabilityResult(summary)
      setNotice(summary)
      setEntryBundleInspection(null)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import entry bundle.')
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleExportVaultBackup(): Promise<void> {
    setIsPortabilityBusy(true)
    setError('')

    try {
      const result = await vaultApi.exportVaultBackup()
      const summary = summarizePortabilityResult(result.message, result.warnings)
      setLastPortabilityResult(summary)
      setNotice(summary)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : 'Failed to export vault backup.')
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleInspectVaultBackup(): Promise<void> {
    setIsPortabilityBusy(true)
    setError('')

    try {
      const inspection = await vaultApi.inspectVaultBackup()
      setEntryBundleInspection(null)
      setVaultBackupInspection(inspection)
      if (inspection) {
        setNotice('Vault backup ready for review.')
      }
    } catch (inspectionError) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : 'Failed to inspect the vault backup.'
      )
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleRestoreReviewedVaultBackup(): Promise<void> {
    if (!vaultBackupInspection) {
      return
    }

    setIsPortabilityBusy(true)
    setError('')

    try {
      const result = await vaultApi.restoreVaultBackup(vaultBackupInspection.packagePath)
      if (result.importedEntryIds[0]) {
        setSelectedId(result.importedEntryIds[0])
      }
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      const summary = summarizePortabilityResult(result.message, result.warnings)
      setLastPortabilityResult(summary)
      setNotice(summary)
      setVaultBackupInspection(null)
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : 'Failed to restore vault backup.'
      )
    } finally {
      setIsPortabilityBusy(false)
    }
  }

  async function handleToggleFlag(
    entry: VaultEntry,
    key: 'isFavorite' | 'isPinned' | 'isTemplate',
    noticeMessage: string
  ): Promise<void> {
    const payload = {
      ...toEntryInput(entry),
      [key]: !entry[key]
    }

    try {
      await vaultApi.updateEntry(entry.id, payload)
      await Promise.all([
        refreshEntries(filters),
        refreshReferenceData(),
        refreshRelationships(selectedEntry?.id ?? null)
      ])
      setNotice(noticeMessage)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update entry flags.')
    }
  }

  async function handleCreateRelationship(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!selectedEntry || !relationshipDraft.targetEntryId) {
      setError('Choose a related item first.')
      return
    }

    setIsCreatingRelationship(true)
    try {
      await vaultApi.createRelationship({
        sourceEntryId: selectedEntry.id,
        targetEntryId: relationshipDraft.targetEntryId,
        relationshipType: relationshipDraft.relationshipType
      })
      await refreshRelationships(selectedEntry.id)
      setRelationshipDraft({
        targetEntryId: '',
        relationshipType: relationshipTypes[0]
      })
      setNotice('Relationship added.')
    } catch (relationshipError) {
      setError(
        relationshipError instanceof Error ? relationshipError.message : 'Failed to add relationship.'
      )
    } finally {
      setIsCreatingRelationship(false)
    }
  }

  async function handleDeleteRelationship(relationshipId: string): Promise<void> {
    if (!selectedEntry) {
      return
    }

    await vaultApi.deleteRelationship(relationshipId)
    await refreshRelationships(selectedEntry.id)
    setNotice('Relationship removed.')
  }

  async function handleDuplicateTemplate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!selectedEntry) {
      return
    }

    if (!duplicateDraft.newProjectName.trim() || !duplicateDraft.destinationParentPath.trim()) {
      setError('A destination folder and new project name are required.')
      return
    }

    setIsDuplicating(true)
    try {
      const duplicated = await vaultApi.duplicateTemplate({
        templateEntryId: selectedEntry.id,
        destinationParentPath: duplicateDraft.destinationParentPath,
        newProjectName: duplicateDraft.newProjectName
      })

      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setSelectedId(duplicated.id)
      setShowDuplicateTemplate(false)
      setNotice('Template duplicated and added to the vault.')
    } catch (duplicateError) {
      setError(
        duplicateError instanceof Error ? duplicateError.message : 'Failed to duplicate template.'
      )
    } finally {
      setIsDuplicating(false)
    }
  }

  async function handleAttachPreviewToEntry(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const result = await vaultApi.importPreviewImage()
    if (result.canceled || !result.path) {
      return
    }

    setIsManagingPreviews(true)
    try {
      const updated = await vaultApi.attachPreviewImageToEntry(selectedEntry.id, result.path)
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Preview attached.')
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to attach preview.')
    } finally {
      setIsManagingPreviews(false)
    }
  }

  async function handleMoveEntryPreview(previewId: string, direction: 'left' | 'right'): Promise<void> {
    if (!selectedEntry) {
      return
    }

    setIsManagingPreviews(true)
    try {
      const updated = await vaultApi.movePreviewImage(selectedEntry.id, previewId, direction)
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to reorder preview.')
    } finally {
      setIsManagingPreviews(false)
    }
  }

  async function handleRemoveEntryPreview(previewId: string): Promise<void> {
    if (!selectedEntry) {
      return
    }

    setIsManagingPreviews(true)
    try {
      const updated = await vaultApi.removePreviewImage(selectedEntry.id, previewId)
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Preview removed.')
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to remove preview.')
    } finally {
      setIsManagingPreviews(false)
    }
  }

  function addSuggestedTag(tag: string): void {
    setDraft((current) => ({
      ...current,
      tags: [...current.tags, tag]
    }))
  }

  function removeInlineTag(tag: string): void {
    setInlineDraft((current) => ({
      ...current,
      tags: current.tags.filter((value) => value !== tag)
    }))
  }

  function updateImportCandidate(
    tempId: string,
    updater: (candidate: ImportCandidateState) => ImportCandidateState
  ): void {
    setImportCandidates((current) =>
      current.map((candidate) => (candidate.tempId === tempId ? syncPreviewPath(updater(candidate)) : candidate))
    )
  }

  function moveImportPreview(tempId: string, previewId: string, direction: 'left' | 'right'): void {
    updateImportCandidate(tempId, (current) => {
      const previewImages = [...current.previewImages]
      const index = previewImages.findIndex((image) => image.id === previewId)
      if (index === -1) {
        return current
      }

      const targetIndex = direction === 'left' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= previewImages.length) {
        return current
      }

      ;[previewImages[index], previewImages[targetIndex]] = [previewImages[targetIndex], previewImages[index]]

      return {
        ...current,
        previewImages
      }
    })
  }

  function removeImportPreview(tempId: string, previewId: string): void {
    updateImportCandidate(tempId, (current) => ({
      ...current,
      previewImages: current.previewImages.filter((image) => image.id !== previewId)
    }))
  }

  async function startSingleImport(mode: 'folder' | 'file'): Promise<void> {
    setIsScanningImport(true)
    setError('')
    setNotice('')

    try {
      const selection =
        mode === 'folder' ? await vaultApi.pickRootPath() : await vaultApi.pickEntryFile()
      if (selection.canceled || !selection.path) {
        return
      }

      const candidate = await vaultApi.scanImportCandidate(selection.path)
      setImportCandidates(await hydrateImportCandidates([candidate]))
      setNotice('Import candidate ready for review.')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to scan import source.')
    } finally {
      setIsScanningImport(false)
    }
  }

  async function startBatchImport(): Promise<void> {
    setIsScanningImport(true)
    setError('')
    setNotice('')

    try {
      const selection = await vaultApi.pickRootPath()
      if (selection.canceled || !selection.path) {
        return
      }

      const candidates = await vaultApi.scanBatchImportCandidates(selection.path)
      setImportCandidates(await hydrateImportCandidates(candidates))
      setNotice(`${candidates.length} import candidate${candidates.length === 1 ? '' : 's'} ready.`)
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : 'Failed to scan the batch import folder.'
      )
    } finally {
      setIsScanningImport(false)
    }
  }

  async function handleImportPreviewChange(tempId: string, nextPath: string): Promise<void> {
    const candidate = importCandidates.find((item) => item.tempId === tempId)
    if (!candidate) {
      return
    }

    updateImportCandidate(tempId, (current) => ({
      ...current,
      activePreviewPath: nextPath,
      quickPreview: null
    }))

    const preview = await loadQuickPreview(nextPath, candidate.rootPath)
    updateImportCandidate(tempId, (current) => ({
      ...current,
      activePreviewPath: nextPath,
      quickPreview: preview
    }))
  }

  async function attachImportPreview(tempId: string): Promise<void> {
    const result = await vaultApi.importPreviewImage()
    if (result.canceled || !result.path) {
      return
    }
    const previewPath = result.path

    updateImportCandidate(tempId, (current) => ({
      ...current,
      previewImages: [
        ...current.previewImages,
        {
          id: crypto.randomUUID(),
          path: previewPath,
          order: current.previewImages.length,
          createdAt: new Date().toISOString(),
          isMissing: false
        }
      ],
      previewImageCandidates: current.previewImageCandidates.some((image) => image.path === previewPath)
        ? current.previewImageCandidates
        : [
            ...current.previewImageCandidates,
            {
              path: previewPath,
              label: previewPath.split('/').pop() ?? 'Attached preview'
            }
          ]
    }))
  }

  async function handleSaveImports(): Promise<void> {
    const acceptedCandidates = importCandidates.filter((candidate) => candidate.decision === 'keep')
    if (acceptedCandidates.length === 0) {
      setError('Mark at least one import candidate as keep before saving.')
      return
    }

    setIsSavingImports(true)
    setError('')

    try {
      const results = await vaultApi.saveImportCandidates(
        acceptedCandidates.map((candidate) => getImportCandidateInput(candidate))
      )

      const successes = results.filter((result) => result.success && result.entry)
      const failures = results.filter((result) => !result.success)

      if (successes.length > 0) {
        setSelectedId(successes[0].entry?.id ?? null)
      }

      if (failures.length === 0) {
        setImportCandidates([])
        setNotice(
          `${successes.length} import${successes.length === 1 ? '' : 's'} added to the vault.`
        )
      } else {
        const failureMessages = new Map(failures.map((failure) => [failure.tempId, failure.message]))
        setImportCandidates((current) =>
          current
            .filter((candidate) => failureMessages.has(candidate.tempId))
            .map((candidate) => ({
              ...candidate,
              importError: failureMessages.get(candidate.tempId) ?? 'Import failed.'
            }))
        )
        setError(
          `${failures.length} import${failures.length === 1 ? '' : 's'} failed. Review and retry.`
        )
        if (successes.length > 0) {
          setNotice(`${successes.length} import${successes.length === 1 ? '' : 's'} saved.`)
        }
      }

      await Promise.all([refreshEntries(filters), refreshReferenceData()])
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save imports.')
    } finally {
      setIsSavingImports(false)
    }
  }

  async function handleDetailPreviewChange(event: React.ChangeEvent<HTMLSelectElement>): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const nextPath = event.target.value
    setDetailPreviewPath(nextPath)
    setDetailPreview(await loadQuickPreview(nextPath, selectedEntry.rootPath))
  }

  async function handleRelinkRoot(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const selection = await vaultApi.pickRootPath()
    if (selection.canceled || !selection.path) {
      return
    }

    try {
      const updated = await vaultApi.relinkEntryPaths({
        entryId: selectedEntry.id,
        newRootPath: selection.path
      })
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Root path relinked.')
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : 'Failed to relink root path.')
    }
  }

  async function handleRelinkEntryFile(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const selection = await vaultApi.pickEntryFile()
    if (selection.canceled || !selection.path) {
      return
    }

    try {
      const updated = await vaultApi.relinkEntryPaths({
        entryId: selectedEntry.id,
        newEntryFilePath: selection.path
      })
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Entry file relinked.')
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : 'Failed to relink entry file.')
    }
  }

  async function handleReplaceMissingPreview(previewId: string): Promise<void> {
    if (!selectedEntry) {
      return
    }

    const result = await vaultApi.importPreviewImage()
    if (result.canceled || !result.path) {
      return
    }

    try {
      const updated = await vaultApi.relinkEntryPaths({
        entryId: selectedEntry.id,
        previewReplacements: [
          {
            previewId,
            newSourcePath: result.path
          }
        ]
      })
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Preview repaired.')
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : 'Failed to repair preview.')
    }
  }

  async function handleBulkRepair(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!bulkRepairDraft.oldPrefix.trim() || !bulkRepairDraft.newPrefix.trim()) {
      setError('Both old and new path prefixes are required.')
      return
    }

    setIsBulkRepairing(true)
    setError('')

    try {
      const result = await vaultApi.bulkRepairPaths({
        oldPrefix: bulkRepairDraft.oldPrefix,
        newPrefix: bulkRepairDraft.newPrefix
      })
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice(
        `Bulk repair updated ${result.updatedEntries} entr${result.updatedEntries === 1 ? 'y' : 'ies'} and ${result.updatedPreviews} preview path${result.updatedPreviews === 1 ? '' : 's'}.`
      )
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : 'Failed to run bulk repair.')
    } finally {
      setIsBulkRepairing(false)
    }
  }

  function renderQuickPreview(preview: QuickFilePreview | null): ReactElement {
    if (!preview) {
      return <p className="detail-notes">No plain-text preview file detected yet.</p>
    }

    if (preview.message) {
      return <p className="detail-notes">{preview.message}</p>
    }

    return (
      <div className="quick-preview-output">
        <div className="quick-preview-meta">
          <span>{preview.relativePath}</span>
          {preview.truncated ? <span>Truncated</span> : null}
        </div>
        <pre>{preview.content}</pre>
      </div>
    )
  }

  function renderPreviewFileOptions(files: PreviewableFile[]): ReactElement[] {
    return files.map((file) => (
      <option key={file.path} value={file.path}>
        {file.relativePath}
      </option>
    ))
  }

  function renderEntryCards(items: VaultEntry[], label: string): ReactElement | null {
    if (items.length === 0) {
      return null
    }

    return (
      <details className="collapsible-section pinned-section">
        <summary className="collapsible-summary">
          <h3>{label}</h3>
          <div className="summary-meta">
            <span className="chip subtle">{items.length}</span>
            <span className="summary-toggle">Show</span>
          </div>
        </summary>
        <div className="card-grid compact collapsible-body">
          {items.map((entry) => (
            <article
              key={`${label}-${entry.id}`}
              className={`entry-card mini ${selectedId === entry.id ? 'selected' : ''}`}
            >
              <div className="entry-card-shell" onClick={() => setSelectedId(entry.id)}>
                {entry.previewImagePath && !entry.previewImages[0]?.isMissing ? (
                  <img alt={`${entry.title} preview`} src={getPreviewSrc(entry.previewImagePath)} />
                ) : (
                  <div className="preview-placeholder">{entry.type}</div>
                )}
                <div className="entry-card-body">
                  <div className="entry-card-header">
                    <h3>{entry.title}</h3>
                  </div>
                  <div className="chip-row">
                    {entry.hasBrokenPaths ? <span className="chip warning">broken</span> : null}
                    {entry.isFavorite ? <span className="chip subtle">favorite</span> : null}
                    {entry.isPinned ? <span className="chip subtle">pinned</span> : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </details>
    )
  }

  function renderPreviewEditor(
    images: PreviewImage[],
    onMove: (previewId: string, direction: 'left' | 'right') => void,
    onRemove: (previewId: string) => void
  ): ReactElement {
    if (images.length === 0) {
      return <p className="detail-notes">No previews attached yet.</p>
    }

    return (
      <div className="preview-editor-list">
        {images.map((image, index) => (
          <div key={image.id} className="preview-editor-row">
            <span className="chip subtle">{index === 0 ? 'primary' : `#${index + 1}`}</span>
            <code className="path-code" title={image.path}>
              {image.path}
            </code>
            <div className="inline-actions">
              <button className="chip-action" type="button" onClick={() => onMove(image.id, 'left')}>
                Left
              </button>
              <button className="chip-action" type="button" onClick={() => onMove(image.id, 'right')}>
                Right
              </button>
              <button className="chip-action" type="button" onClick={() => onRemove(image.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Phase 4</p>
          <h1>Code Vault</h1>
          <p className="lede">
            A local visual catalog for snippets, experiments, mini-apps, and reusable code artifacts.
          </p>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <h2>Import</h2>
            {importCandidates.length > 0 ? (
              <button className="ghost-button" type="button" onClick={() => setImportCandidates([])}>
                Clear review
              </button>
            ) : null}
          </div>
          <p className="detail-notes">
            Scan existing folders or files, review detected metadata and preview ordering, then save
            only the entries you want.
          </p>
          <div className="action-grid">
            <button
              className="ghost-button"
              disabled={isScanningImport}
              type="button"
              onClick={() => void startSingleImport('folder')}
            >
              Import folder
            </button>
            <button
              className="ghost-button"
              disabled={isScanningImport}
              type="button"
              onClick={() => void startSingleImport('file')}
            >
              Import file
            </button>
            <button
              className="ghost-button"
              disabled={isScanningImport}
              type="button"
              onClick={() => void startBatchImport()}
            >
              Batch import folder
            </button>
          </div>
          {importCandidates.length > 0 ? (
            <p className="import-summary">
              {acceptedImportCount} of {importCandidates.length} candidate
              {importCandidates.length === 1 ? '' : 's'} set to keep.
            </p>
          ) : null}
        </section>

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

          <label className="field">
            <span>Sort</span>
            <select
              value={filters.sortBy}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sortBy: event.target.value as EntryFilters['sortBy']
                }))
              }
            >
              {sortOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className="toggle-grid">
            <label className="checkbox-field">
              <input
                checked={filters.includeArchived}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, includeArchived: event.target.checked }))
                }
              />
              <span>Include archived</span>
            </label>

            <label className="checkbox-field">
              <input
                checked={filters.onlyFavorites}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, onlyFavorites: event.target.checked }))
                }
              />
              <span>Favorites only</span>
            </label>

            <label className="checkbox-field">
              <input
                checked={filters.onlyPinned}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, onlyPinned: event.target.checked }))
                }
              />
              <span>Pinned only</span>
            </label>

            <label className="checkbox-field">
              <input
                checked={filters.onlyTemplates}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, onlyTemplates: event.target.checked }))
                }
              />
              <span>Templates only</span>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Bulk Repair</h2>
          </div>
          <p className="detail-notes">
            Replace an old root prefix with a new one across matching entries and preview paths.
          </p>
          <form className="entry-form compact-form" onSubmit={(event) => void handleBulkRepair(event)}>
            <label className="field">
              <span>Old prefix</span>
              <input
                value={bulkRepairDraft.oldPrefix}
                onChange={(event) =>
                  setBulkRepairDraft((current) => ({ ...current, oldPrefix: event.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>New prefix</span>
              <input
                value={bulkRepairDraft.newPrefix}
                onChange={(event) =>
                  setBulkRepairDraft((current) => ({ ...current, newPrefix: event.target.value }))
                }
              />
            </label>

            <button className="ghost-button" disabled={isBulkRepairing} type="submit">
              {isBulkRepairing ? 'Repairing...' : 'Run bulk repair'}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Portability</h2>
          </div>
          <p className="detail-notes">
            Create portable entry bundles, full vault backups, and restore packages on another
            machine without leaving the app.
          </p>
          <div className="action-grid">
            <button
              className="ghost-button"
              disabled={isPortabilityBusy}
              type="button"
              onClick={() => void handleInspectEntryBundle()}
            >
              Import entry bundle
            </button>
            <button
              className="ghost-button"
              disabled={isPortabilityBusy}
              type="button"
              onClick={() => void handleExportVaultBackup()}
            >
              Create full backup
            </button>
            <button
              className="ghost-button"
              disabled={isPortabilityBusy}
              type="button"
              onClick={() => void handleInspectVaultBackup()}
            >
              Restore backup
            </button>
          </div>
          {lastPortabilityResult ? (
            <p className="detail-notes portability-summary">{lastPortabilityResult}</p>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>{formMode === 'create' ? 'Add Entry' : 'Edit Entry'}</h2>
            <div className="inline-actions">
              <button className="ghost-button" type="button" onClick={() => void handleRefreshMetadata()}>
                {isDetectingMetadata ? 'Detecting...' : 'Detect metadata'}
              </button>
              {formMode === 'edit' ? (
                <button className="ghost-button" type="button" onClick={resetCreateForm}>
                  New entry
                </button>
              ) : null}
            </div>
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

            <div className="toggle-grid">
              <label className="checkbox-field">
                <input
                  checked={draft.isFavorite}
                  type="checkbox"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, isFavorite: event.target.checked }))
                  }
                />
                <span>Favorite</span>
              </label>

              <label className="checkbox-field">
                <input
                  checked={draft.isPinned}
                  type="checkbox"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, isPinned: event.target.checked }))
                  }
                />
                <span>Pinned</span>
              </label>

              <label className="checkbox-field">
                <input
                  checked={draft.isTemplate}
                  type="checkbox"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, isTemplate: event.target.checked }))
                  }
                />
                <span>Template</span>
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

            {suggestedTags.length > 0 ? (
              <div className="suggestion-row">
                {suggestedTags.map((tag) => (
                  <button
                    key={tag}
                    className="chip-action"
                    type="button"
                    onClick={() => addSuggestedTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}

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
              <span>Run command</span>
              <input
                value={draft.runCommand}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, runCommand: event.target.value }))
                }
                placeholder="npm run dev"
              />
            </label>

            <div className="detail-block quick-preview-panel">
              <div className="panel-heading">
                <h3>Preview gallery</h3>
                <button className="ghost-button" type="button" onClick={() => void attachPreviewToDraft()}>
                  Attach preview
                </button>
              </div>
              {renderPreviewEditor(draft.previewImages, moveDraftPreview, removeDraftPreview)}
            </div>

            <label className="field">
              <span>Good for</span>
              <textarea
                rows={2}
                value={draft.goodFor}
                onChange={(event) => setDraft((current) => ({ ...current, goodFor: event.target.value }))}
              />
            </label>

            <label className="field">
              <span>Setup notes</span>
              <textarea
                rows={2}
                value={draft.setupNotes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, setupNotes: event.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Dependency notes</span>
              <textarea
                rows={2}
                value={draft.dependencyNotes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, dependencyNotes: event.target.value }))
                }
              />
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

        {entryBundleInspection ? (
          <section className="import-review-panel portability-review-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Phase 5 portability review</p>
                <h2>Entry bundle</h2>
              </div>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  disabled={isPortabilityBusy}
                  type="button"
                  onClick={() => void handleImportReviewedEntryBundle()}
                >
                  {isPortabilityBusy ? 'Importing...' : 'Import bundle'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setEntryBundleInspection(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>

            <div className="detail-meta portability-grid">
              <div className="detail-block">
                <h3>{entryBundleInspection.title}</h3>
                <div className="chip-row">
                  <span className="chip">{entryBundleInspection.type}</span>
                  <span className="chip subtle">{entryBundleInspection.previewCount} previews</span>
                  <span className="chip subtle">
                    {entryBundleInspection.sourceFileCount} source files
                  </span>
                  <span className="chip subtle">
                    {entryBundleInspection.relationshipCount} relationships
                  </span>
                </div>
                <code className="path-code" title={entryBundleInspection.packagePath}>
                  {entryBundleInspection.packagePath}
                </code>
              </div>

              <div className="detail-block">
                <h3>Warnings</h3>
                {entryBundleInspection.warnings.length === 0 ? (
                  <p className="detail-notes">No bundle warnings detected.</p>
                ) : (
                  <div className="relationship-list">
                    {entryBundleInspection.warnings.map((warning) => (
                      <div key={warning} className="relationship-card">
                        <p className="detail-notes">{warning}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="detail-block">
              <h3>Possible duplicates</h3>
              {entryBundleInspection.duplicateMatches.length === 0 ? (
                <p className="detail-notes">No likely duplicates detected in this vault.</p>
              ) : (
                <div className="relationship-list">
                  {entryBundleInspection.duplicateMatches.map((match, index) => (
                    <div key={`${match.entryId}-${match.type}-${index}`} className="relationship-card">
                      <div>
                        <p className="eyebrow">{match.type}</p>
                        <strong>{match.title}</strong>
                        <p className="detail-notes">{match.detail}</p>
                      </div>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setSelectedId(match.entryId)}
                      >
                        Open existing
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {vaultBackupInspection ? (
          <section className="import-review-panel portability-review-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Phase 5 portability review</p>
                <h2>Vault backup</h2>
              </div>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  disabled={isPortabilityBusy}
                  type="button"
                  onClick={() => void handleRestoreReviewedVaultBackup()}
                >
                  {isPortabilityBusy ? 'Restoring...' : 'Restore backup'}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setVaultBackupInspection(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>

            <div className="detail-meta portability-grid">
              <div className="detail-block">
                <h3>{vaultBackupInspection.displayName}</h3>
                <div className="chip-row">
                  <span className="chip subtle">{vaultBackupInspection.entryCount} entries</span>
                  <span className="chip subtle">
                    {vaultBackupInspection.relationshipCount} relationships
                  </span>
                  <span className="chip subtle">{vaultBackupInspection.previewCount} previews</span>
                  <span className="chip subtle">
                    {vaultBackupInspection.sourceBundleCount} source bundles
                  </span>
                </div>
                <code className="path-code" title={vaultBackupInspection.packagePath}>
                  {vaultBackupInspection.packagePath}
                </code>
              </div>

              <div className="detail-block">
                <h3>Warnings</h3>
                {vaultBackupInspection.warnings.length === 0 ? (
                  <p className="detail-notes">No backup warnings detected.</p>
                ) : (
                  <div className="relationship-list">
                    {vaultBackupInspection.warnings.map((warning) => (
                      <div key={warning} className="relationship-card">
                        <p className="detail-notes">{warning}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="detail-block">
              <h3>Possible duplicates</h3>
              {vaultBackupInspection.duplicateMatches.length === 0 ? (
                <p className="detail-notes">No likely title duplicates detected in this vault.</p>
              ) : (
                <div className="relationship-list">
                  {vaultBackupInspection.duplicateMatches.map((match, index) => (
                    <div key={`${match.entryId}-${match.type}-${index}`} className="relationship-card">
                      <div>
                        <p className="eyebrow">{match.type}</p>
                        <strong>{match.title}</strong>
                        <p className="detail-notes">{match.detail}</p>
                      </div>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setSelectedId(match.entryId)}
                      >
                        Open existing
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {importCandidates.length > 0 ? (
          <section className="import-review-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Phase 4 import review</p>
                <h2>{importCandidates.length} candidate{importCandidates.length === 1 ? '' : 's'}</h2>
              </div>
              <div className="inline-actions">
                <button
                  className="primary-button"
                  disabled={isSavingImports}
                  type="button"
                  onClick={() => void handleSaveImports()}
                >
                  {isSavingImports
                    ? 'Saving...'
                    : `Save ${acceptedImportCount} accepted import${acceptedImportCount === 1 ? '' : 's'}`}
                </button>
                <button className="ghost-button" type="button" onClick={() => setImportCandidates([])}>
                  Dismiss
                </button>
              </div>
            </div>

            <div className="import-candidate-list">
              {importCandidates.map((candidate) => (
                <article key={candidate.tempId} className="import-candidate-card">
                  <div className="panel-heading import-candidate-header">
                    <div>
                      <p className="eyebrow">{candidate.sourceKind} import</p>
                      <h3>{candidate.title || 'Untitled import'}</h3>
                    </div>
                    <div className="import-decision-row">
                      <button
                        className={candidate.decision === 'keep' ? 'primary-button' : 'ghost-button'}
                        type="button"
                        onClick={() =>
                          updateImportCandidate(candidate.tempId, (current) => ({
                            ...current,
                            decision: 'keep',
                            importError: ''
                          }))
                        }
                      >
                        Keep
                      </button>
                      <button
                        className={candidate.decision === 'skip' ? 'danger-button' : 'ghost-button'}
                        type="button"
                        onClick={() =>
                          updateImportCandidate(candidate.tempId, (current) => ({
                            ...current,
                            decision: 'skip'
                          }))
                        }
                      >
                        Skip
                      </button>
                    </div>
                  </div>

                  {candidate.duplicateRootPath ? (
                    <p className="duplicate-warning">
                      A vault entry already uses this root path. Leave this on skip unless you want a
                      second record.
                    </p>
                  ) : null}

                  {candidate.importError ? (
                    <p className="status-message error">{candidate.importError}</p>
                  ) : null}

                  <div className="import-candidate-grid">
                    <div className="entry-form compact-form">
                      <label className="field">
                        <span>Title</span>
                        <input
                          value={candidate.title}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              title: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Description</span>
                        <textarea
                          rows={3}
                          value={candidate.description}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              description: event.target.value
                            }))
                          }
                        />
                      </label>

                      <div className="filter-row">
                        <label className="field">
                          <span>Type</span>
                          <select
                            value={candidate.type}
                            onChange={(event) =>
                              updateImportCandidate(candidate.tempId, (current) => ({
                                ...current,
                                type: event.target.value as ImportCandidate['type']
                              }))
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
                            value={candidate.status}
                            onChange={(event) =>
                              updateImportCandidate(candidate.tempId, (current) => ({
                                ...current,
                                status: event.target.value as ImportCandidate['status']
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
                          value={candidate.tags.join(', ')}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              tags: parseTags(event.target.value)
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Stack / language</span>
                        <input
                          value={candidate.stack}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              stack: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Root path</span>
                        <input
                          value={candidate.rootPath}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              rootPath: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Entry file path</span>
                        <input
                          value={candidate.entryFilePath}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              entryFilePath: event.target.value
                            }))
                          }
                        />
                      </label>

                      <label className="field">
                        <span>Run command</span>
                        <input
                          value={candidate.runCommand}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              runCommand: event.target.value
                            }))
                          }
                        />
                      </label>

                      <div className="detail-block quick-preview-panel">
                        <div className="panel-heading">
                          <h3>Preview gallery</h3>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => void attachImportPreview(candidate.tempId)}
                          >
                            Attach
                          </button>
                        </div>
                        {renderPreviewEditor(
                          candidate.previewImages,
                          (previewId, direction) => moveImportPreview(candidate.tempId, previewId, direction),
                          (previewId) => removeImportPreview(candidate.tempId, previewId)
                        )}
                      </div>

                      <label className="field">
                        <span>Notes</span>
                        <textarea
                          rows={3}
                          value={candidate.notes}
                          onChange={(event) =>
                            updateImportCandidate(candidate.tempId, (current) => ({
                              ...current,
                              notes: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>

                    <div className="detail-block quick-preview-panel">
                      <div className="panel-heading">
                        <h3>Quick preview</h3>
                        <code className="path-code" title={candidate.sourcePath}>
                          {candidate.sourcePath}
                        </code>
                      </div>

                      {candidate.previewableFiles.length > 0 ? (
                        <label className="field">
                          <span>Preview file</span>
                          <select
                            value={candidate.activePreviewPath}
                            onChange={(event) =>
                              void handleImportPreviewChange(candidate.tempId, event.target.value)
                            }
                          >
                            {renderPreviewFileOptions(candidate.previewableFiles)}
                          </select>
                        </label>
                      ) : null}

                      {renderQuickPreview(candidate.quickPreview)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="workspace">
          <div className="vault-panel">
            {isLoading ? <div className="empty-state">Loading your vault...</div> : null}

            {!isLoading && entries.length === 0 ? (
              <div className="empty-state">
                <h3>No entries yet</h3>
                <p>Add your first item or import an existing project to start building your vault.</p>
              </div>
            ) : null}

            {!isLoading && recentActivity ? (
              <>
                {renderEntryCards(recentActivity.viewed, 'Recently viewed')}
                {renderEntryCards(recentActivity.created, 'Recently added')}
                {renderEntryCards(recentActivity.updated, 'Recently updated')}
              </>
            ) : null}

            {!isLoading && pinnedEntries.length > 0 ? (
              <section className="pinned-section">
                <div className="panel-heading">
                  <h3>Pinned items</h3>
                  <span className="chip subtle">{pinnedEntries.length}</span>
                </div>
                <div className="card-grid compact">
                  {pinnedEntries.map((entry) => (
                    <article
                      key={`pinned-${entry.id}`}
                      className={`entry-card mini ${selectedId === entry.id ? 'selected' : ''}`}
                    >
                      <div className="entry-card-shell" onClick={() => setSelectedId(entry.id)}>
                        {entry.previewImagePath && !entry.previewImages[0]?.isMissing ? (
                          <img alt={`${entry.title} preview`} src={getPreviewSrc(entry.previewImagePath)} />
                        ) : (
                          <div className="preview-placeholder">{entry.type}</div>
                        )}
                        <div className="entry-card-body">
                          <div className="entry-card-header">
                            <h3>{entry.title}</h3>
                          </div>
                          <div className="chip-row">
                            <span className="chip subtle">pinned</span>
                            {entry.isFavorite ? <span className="chip subtle">favorite</span> : null}
                            {entry.isTemplate ? <span className="chip subtle">template</span> : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {!isLoading && entries.length > 0 ? (
              <div className="card-grid">
                {entries.map((entry) => (
                  <article
                    key={entry.id}
                    className={`entry-card ${selectedId === entry.id ? 'selected' : ''}`}
                  >
                    <div className="entry-card-shell" onClick={() => setSelectedId(entry.id)}>
                      {entry.previewImagePath && !entry.previewImages[0]?.isMissing ? (
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
                          {entry.hasBrokenPaths ? <span className="chip warning">broken</span> : null}
                          {entry.isFavorite ? <span className="chip subtle">favorite</span> : null}
                          {entry.isPinned ? <span className="chip subtle">pinned</span> : null}
                          {entry.isTemplate ? <span className="chip subtle">template</span> : null}
                          {entry.runCommand ? <span className="chip subtle">runnable</span> : null}
                          {entry.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="chip subtle">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="card-controls">
                      <button
                        className="chip-action"
                        type="button"
                        onClick={() =>
                          void handleToggleFlag(
                            entry,
                            'isFavorite',
                            entry.isFavorite ? 'Removed from favorites.' : 'Added to favorites.'
                          )
                        }
                      >
                        {entry.isFavorite ? 'Unfavorite' : 'Favorite'}
                      </button>
                      <button
                        className="chip-action"
                        type="button"
                        onClick={() =>
                          void handleToggleFlag(
                            entry,
                            'isPinned',
                            entry.isPinned ? 'Entry unpinned.' : 'Entry pinned.'
                          )
                        }
                      >
                        {entry.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <section className="detail-panel">
            {selectedEntry ? (
              <>
                <div className="detail-preview">
                  {selectedPreview && !selectedPreview.isMissing ? (
                    <img
                      alt={`${selectedEntry.title} preview`}
                      src={getPreviewSrc(selectedPreview.path)}
                    />
                  ) : (
                    <div className="preview-placeholder large">
                      {selectedPreview?.isMissing ? 'Missing preview' : selectedEntry.type}
                    </div>
                  )}
                </div>

                {selectedEntry.previewImages.length > 0 ? (
                  <div className="thumbnail-strip">
                    {selectedEntry.previewImages.map((image) => (
                      <button
                        key={image.id}
                        className={`thumbnail-button ${selectedPreview?.id === image.id ? 'selected' : ''}`}
                        type="button"
                        onClick={() => setSelectedPreviewId(image.id)}
                      >
                        {image.isMissing ? (
                          <span>Missing</span>
                        ) : (
                          <img alt={`${selectedEntry.title} thumbnail`} src={getPreviewSrc(image.path)} />
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="detail-header">
                  <div>
                    <p className="eyebrow">Item detail</p>
                    <h2>{selectedEntry.title}</h2>
                  </div>
                  <div className="detail-actions">
                    <button className="ghost-button" type="button" onClick={startEdit}>
                      Edit form
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void handleToggleFlag(
                          selectedEntry,
                          'isFavorite',
                          selectedEntry.isFavorite
                            ? 'Removed from favorites.'
                            : 'Added to favorites.'
                        )
                      }
                    >
                      {selectedEntry.isFavorite ? 'Unfavorite' : 'Favorite'}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void handleToggleFlag(
                          selectedEntry,
                          'isPinned',
                          selectedEntry.isPinned ? 'Entry unpinned.' : 'Entry pinned.'
                        )
                      }
                    >
                      {selectedEntry.isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        void handleToggleFlag(
                          selectedEntry,
                          'isTemplate',
                          selectedEntry.isTemplate
                            ? 'Template badge removed.'
                            : 'Marked as template.'
                        )
                      }
                    >
                      {selectedEntry.isTemplate ? 'Unset template' : 'Mark template'}
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
                  {selectedEntry.hasBrokenPaths ? <span className="chip warning">broken paths</span> : null}
                  {selectedEntry.isFavorite ? <span className="chip subtle">favorite</span> : null}
                  {selectedEntry.isPinned ? <span className="chip subtle">pinned</span> : null}
                  {selectedEntry.isTemplate ? <span className="chip subtle">template</span> : null}
                  {selectedEntry.runCommand ? <span className="chip subtle">runnable</span> : null}
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
                      <code className="path-code" title={selectedEntry.rootPath}>
                        {selectedEntry.rootPath}
                      </code>
                    </div>
                    {selectedEntry.entryFilePath ? (
                      <div className="meta-line">
                        <span>Entry file</span>
                        <code className="path-code" title={selectedEntry.entryFilePath}>
                          {selectedEntry.entryFilePath}
                        </code>
                      </div>
                    ) : null}
                    {selectedPreview ? (
                      <div className="meta-line">
                        <span>Selected preview</span>
                        <code className="path-code" title={selectedPreview.path}>
                          {selectedPreview.path}
                        </code>
                      </div>
                    ) : null}
                    {selectedEntry.runCommand ? (
                      <div className="meta-line">
                        <span>Run command</span>
                        <code className="path-code" title={selectedEntry.runCommand}>
                          {selectedEntry.runCommand}
                        </code>
                      </div>
                    ) : null}
                    <div className="meta-line">
                      <span>Last viewed</span>
                      <code className="path-code">{formatDate(selectedEntry.lastViewedAt)}</code>
                    </div>
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
                        disabled={!selectedEntry.runCommand || isRunningCommand}
                        onClick={() => void handleRunCommand()}
                      >
                        {isRunningCommand ? 'Starting...' : 'Run command'}
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
                        disabled={!selectedPreview}
                        onClick={() =>
                          selectedPreview
                            ? void handleOpenPath(selectedPreview.path, 'Preview image')
                            : undefined
                        }
                      >
                        Open preview image
                      </button>
                    </div>
                  </div>
                </div>

                <div className="detail-block quick-preview-panel">
                  <div className="panel-heading">
                    <h3>Portability</h3>
                  </div>
                  <div className="action-grid">
                    <button
                      className="ghost-button"
                      disabled={isPortabilityBusy}
                      type="button"
                      onClick={() => void handleExportEntryMetadata()}
                    >
                      Export metadata JSON
                    </button>
                    <button
                      className="ghost-button"
                      disabled={isPortabilityBusy}
                      type="button"
                      onClick={() => void handleExportEntryBundle()}
                    >
                      Export entry bundle
                    </button>
                    <button
                      className="ghost-button"
                      disabled={isPortabilityBusy}
                      type="button"
                      onClick={() => void handleInspectEntryBundle()}
                    >
                      Import entry bundle
                    </button>
                  </div>
                </div>

                <div className="detail-block quick-preview-panel">
                  <div className="panel-heading">
                    <h3>Preview gallery</h3>
                    <div className="inline-actions">
                      <button
                        className="ghost-button"
                        disabled={isManagingPreviews}
                        type="button"
                        onClick={() => void handleAttachPreviewToEntry()}
                      >
                        Add preview
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!selectedPreview || isManagingPreviews}
                        type="button"
                        onClick={() =>
                          selectedPreview
                            ? void handleMoveEntryPreview(selectedPreview.id, 'left')
                            : undefined
                        }
                      >
                        Move left
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!selectedPreview || isManagingPreviews}
                        type="button"
                        onClick={() =>
                          selectedPreview
                            ? void handleMoveEntryPreview(selectedPreview.id, 'right')
                            : undefined
                        }
                      >
                        Move right
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!selectedPreview || isManagingPreviews}
                        type="button"
                        onClick={() =>
                          selectedPreview
                            ? void handleRemoveEntryPreview(selectedPreview.id)
                            : undefined
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {renderPreviewEditor(
                    selectedEntry.previewImages,
                    (previewId, direction) => void handleMoveEntryPreview(previewId, direction),
                    (previewId) => void handleRemoveEntryPreview(previewId)
                  )}
                </div>

                <div className="detail-block">
                  <div className="panel-heading">
                    <h3>Quick edit</h3>
                    <button
                      className="primary-button"
                      disabled={isSavingInline}
                      type="button"
                      onClick={() => void handleSaveInline()}
                    >
                      {isSavingInline ? 'Saving...' : 'Save quick changes'}
                    </button>
                  </div>

                  <div className="inline-edit-grid">
                    <label className="field">
                      <span>Title</span>
                      <input
                        value={inlineDraft.title}
                        onChange={(event) =>
                          setInlineDraft((current) => ({ ...current, title: event.target.value }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Status</span>
                      <select
                        value={inlineDraft.status}
                        onChange={(event) =>
                          setInlineDraft((current) => ({
                            ...current,
                            status: event.target.value as InlineDraft['status']
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

                    <label className="field">
                      <span>Description</span>
                      <textarea
                        rows={3}
                        value={inlineDraft.description}
                        onChange={(event) =>
                          setInlineDraft((current) => ({
                            ...current,
                            description: event.target.value
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Stack / language</span>
                      <input
                        value={inlineDraft.stack}
                        onChange={(event) =>
                          setInlineDraft((current) => ({ ...current, stack: event.target.value }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Tags</span>
                      <input
                        value={inlineDraft.tags.join(', ')}
                        onChange={(event) =>
                          setInlineDraft((current) => ({
                            ...current,
                            tags: parseTags(event.target.value)
                          }))
                        }
                      />
                    </label>

                    {inlineDraft.tags.length > 0 ? (
                      <div className="chip-row">
                        {inlineDraft.tags.map((tag) => (
                          <button
                            key={tag}
                            className="chip-action"
                            type="button"
                            onClick={() => removeInlineTag(tag)}
                          >
                            Remove {tag}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <label className="field">
                      <span>Good for</span>
                      <textarea
                        rows={2}
                        value={inlineDraft.goodFor}
                        onChange={(event) =>
                          setInlineDraft((current) => ({ ...current, goodFor: event.target.value }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Setup notes</span>
                      <textarea
                        rows={2}
                        value={inlineDraft.setupNotes}
                        onChange={(event) =>
                          setInlineDraft((current) => ({
                            ...current,
                            setupNotes: event.target.value
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Dependency notes</span>
                      <textarea
                        rows={2}
                        value={inlineDraft.dependencyNotes}
                        onChange={(event) =>
                          setInlineDraft((current) => ({
                            ...current,
                            dependencyNotes: event.target.value
                          }))
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Markdown notes</span>
                      <textarea
                        rows={6}
                        value={inlineDraft.notes}
                        onChange={(event) =>
                          setInlineDraft((current) => ({ ...current, notes: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="detail-block">
                  <h3>Markdown preview</h3>
                  <div
                    className="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(inlineDraft.notes) }}
                  />
                </div>

                <div className="detail-block">
                  <h3>Duplicate warnings</h3>
                  {duplicateInspection.matches.length === 0 ? (
                    <p className="detail-notes">No likely duplicates detected.</p>
                  ) : (
                    <div className="relationship-list">
                      {duplicateInspection.matches.map((match, index) => (
                        <div key={`${match.entryId}-${match.type}-${index}`} className="relationship-card">
                          <div>
                            <p className="eyebrow">{match.type}</p>
                            <strong>{match.title}</strong>
                            <p className="detail-notes">{match.detail}</p>
                          </div>
                          <button className="ghost-button" type="button" onClick={() => setSelectedId(match.entryId)}>
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="detail-block">
                  <h3>Path health</h3>
                  {pathHealth ? (
                    <>
                      <div className="meta-line">
                        <span>Root path</span>
                        <p className="detail-notes">
                          {pathHealth.rootPathExists ? 'Healthy' : 'Missing or moved'}
                        </p>
                      </div>
                      <div className="meta-line">
                        <span>Entry file</span>
                        <p className="detail-notes">
                          {pathHealth.entryFileExists ? 'Healthy' : 'Missing or moved'}
                        </p>
                      </div>
                      <div className="meta-line">
                        <span>Missing previews</span>
                        <p className="detail-notes">{pathHealth.missingPreviewImages.length}</p>
                      </div>
                      <div className="inline-actions">
                        <button className="ghost-button" type="button" onClick={() => void handleRelinkRoot()}>
                          Relink root
                        </button>
                        <button className="ghost-button" type="button" onClick={() => void handleRelinkEntryFile()}>
                          Relink entry file
                        </button>
                      </div>
                      {pathHealth.missingPreviewImages.length > 0 ? (
                        <div className="relationship-list">
                          {pathHealth.missingPreviewImages.map((image) => (
                            <div key={image.id} className="relationship-card">
                              <div>
                                <strong>Missing preview</strong>
                                <p className="detail-notes">{image.path}</p>
                              </div>
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => void handleReplaceMissingPreview(image.id)}
                              >
                                Replace
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="detail-notes">No path health information yet.</p>
                  )}
                </div>

                <div className="detail-block quick-preview-panel">
                  <div className="panel-heading">
                    <h3>Quick file preview</h3>
                    <span className="chip subtle">
                      {detailPreviewInspection?.files.length ?? 0} file
                      {(detailPreviewInspection?.files.length ?? 0) === 1 ? '' : 's'}
                    </span>
                  </div>

                  {detailPreviewInspection && detailPreviewInspection.files.length > 0 ? (
                    <label className="field">
                      <span>Preview file</span>
                      <select value={detailPreviewPath} onChange={(event) => void handleDetailPreviewChange(event)}>
                        {renderPreviewFileOptions(detailPreviewInspection.files)}
                      </select>
                    </label>
                  ) : null}

                  {renderQuickPreview(detailPreview)}
                </div>

                {selectedEntry.isTemplate ? (
                  <div className="detail-block">
                    <div className="panel-heading">
                      <h3>Template duplication</h3>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setShowDuplicateTemplate((current) => !current)}
                      >
                        {showDuplicateTemplate ? 'Hide' : 'Duplicate template'}
                      </button>
                    </div>

                    {showDuplicateTemplate ? (
                      <form
                        className="entry-form compact-form"
                        onSubmit={(event) => void handleDuplicateTemplate(event)}
                      >
                        <label className="field">
                          <span>New project name</span>
                          <input
                            value={duplicateDraft.newProjectName}
                            onChange={(event) =>
                              setDuplicateDraft((current) => ({
                                ...current,
                                newProjectName: event.target.value
                              }))
                            }
                          />
                        </label>

                        <label className="field">
                          <span>Destination parent folder</span>
                          <div className="path-input">
                            <input
                              value={duplicateDraft.destinationParentPath}
                              onChange={(event) =>
                                setDuplicateDraft((current) => ({
                                  ...current,
                                  destinationParentPath: event.target.value
                                }))
                              }
                            />
                            <button
                              className="ghost-button"
                              type="button"
                              onClick={() => void pickDuplicateDestination()}
                            >
                              Browse
                            </button>
                          </div>
                        </label>

                        <button className="primary-button" disabled={isDuplicating} type="submit">
                          {isDuplicating ? 'Duplicating...' : 'Create duplicate'}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : null}

                <div className="detail-block">
                  <h3>Related items</h3>
                  {relationships.length === 0 ? (
                    <p className="detail-notes">No related items linked yet.</p>
                  ) : (
                    <div className="relationship-list">
                      {relationships.map((relationship) => (
                        <div key={relationship.id} className="relationship-card">
                          <div>
                            <p className="eyebrow">{getRelationshipLabel(relationship.relationshipType)}</p>
                            <strong>{relationship.target.title}</strong>
                            <p className="detail-notes">
                              {relationship.target.type} · {relationship.target.status}
                            </p>
                          </div>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => void handleDeleteRelationship(relationship.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <form className="entry-form compact-form" onSubmit={(event) => void handleCreateRelationship(event)}>
                    <label className="field">
                      <span>Relationship type</span>
                      <select
                        value={relationshipDraft.relationshipType}
                        onChange={(event) =>
                          setRelationshipDraft((current) => ({
                            ...current,
                            relationshipType: event.target.value as RelationshipType
                          }))
                        }
                      >
                        {relationshipTypes.map((type) => (
                          <option key={type} value={type}>
                            {getRelationshipLabel(type)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Target item</span>
                      <select
                        value={relationshipDraft.targetEntryId}
                        onChange={(event) =>
                          setRelationshipDraft((current) => ({
                            ...current,
                            targetEntryId: event.target.value
                          }))
                        }
                      >
                        <option value="">Choose an item</option>
                        {relatedTargetOptions.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.title}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button className="ghost-button" disabled={isCreatingRelationship} type="submit">
                      {isCreatingRelationship ? 'Adding...' : 'Add relationship'}
                    </button>
                  </form>
                </div>

                <div className="detail-footer">
                  <span>Created {formatDate(selectedEntry.createdAt)}</span>
                  <span>Updated {formatDate(selectedEntry.updatedAt)}</span>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h3>Select an item</h3>
                <p>
                  Pick an entry to inspect its preview gallery, quick-edit fields, duplicate warnings,
                  and repair actions.
                </p>
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  )
}

export { App }
