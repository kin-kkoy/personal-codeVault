import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
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
import { HelpGuide } from './HelpGuide'
import {
  escapeHtml,
  formatCompactDate,
  formatDate,
  getRelationshipLabel,
  normalizeDraft,
  parseTags,
  renderInlineMarkdown,
  renderMarkdown,
  syncPreviewPath,
  toEntryInput,
  withPreviewOrdering
} from '@shared/utils'

type FormMode = 'create' | 'edit'
type ImportDecision = 'keep' | 'skip'
type ThemeMode = 'light' | 'dark'
type NavSection = 'browse' | 'import' | 'repair' | 'portability'
type WorkflowOverlay = 'entry' | null
type DockTabId = 'import' | 'bulkRepair' | 'portability'

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

type ImportCandidateState = ImportCandidate & {
  decision: ImportDecision
  activePreviewPath: string
  quickPreview: QuickFilePreview | null
  importError: string
}

function getImportCandidateInput(candidate: ImportCandidateState): ImportCandidate {
  return {
    ...candidate,
    ...toEntryInput(candidate)
  }
}

function getPreviewSrc(path: string): string {
  return convertFileSrc(path)
}

const videoExtensions = new Set(['.mp4', '.webm'])

function isVideoPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return videoExtensions.has(ext)
}

function PreviewMedia({ src, alt, className }: { src: string; alt: string; className?: string }): ReactElement {
  if (isVideoPath(src)) {
    return (
      <video
        autoPlay
        loop
        muted
        playsInline
        className={className}
        src={getPreviewSrc(src)}
      />
    )
  }
  return <img alt={alt} className={className} src={getPreviewSrc(src)} />
}

function loadStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function App(): ReactElement {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'dark'
    }

    const stored = window.localStorage.getItem('code-vault-theme')
    return stored === 'light' ? 'light' : 'dark'
  })
  const [activeNavSection, setActiveNavSection] = useState<NavSection>('browse')
  const [activeOverlay, setActiveOverlay] = useState<WorkflowOverlay>(null)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => loadStored('cv-selected-id', null))
  const [filters, setFilters] = useState<EntryFilters>(() => loadStored('cv-filters', defaultFilters))
  const [draft, setDraft] = useState<EntryDraft>(defaultEntryDraft)
  const [formMode, setFormMode] = useState<FormMode>('create')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
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
  const [sidebarWidth, setSidebarWidth] = useState(() => loadStored('cv-sidebar-width', 278))
  const [detailWidth, setDetailWidth] = useState(() =>
    loadStored('cv-detail-width', typeof window !== 'undefined' && window.innerWidth >= 1440 ? 500 : 360)
  )
  const [showHelpGuide, setShowHelpGuide] = useState<string | null>(null)
  const [compactGrid, setCompactGrid] = useState(() => loadStored('cv-compact-grid', false))
  const [openAccordion, setOpenAccordion] = useState<string | null>(null)
  const [carouselInterval, setCarouselInterval] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem('code-vault-carousel-speed')
    if (stored === null) return null
    const val = Number(stored)
    return val > 0 ? val : null
  })
  const [showFilePreviewModal, setShowFilePreviewModal] = useState(false)
  const [formError, setFormError] = useState('')
  const [openDockTabs, setOpenDockTabs] = useState<DockTabId[]>(() => loadStored('cv-dock-tabs', []))
  const [activeDockTab, setActiveDockTab] = useState<DockTabId | null>(() => loadStored('cv-dock-active', null))
  const [isDockCollapsed, setIsDockCollapsed] = useState(() => loadStored('cv-dock-collapsed', true))
  const [dockLayoutMode, setDockLayoutMode] = useState<'focused' | 'split'>(() => loadStored('cv-dock-layout', 'focused'))
  const [dockHeight, setDockHeight] = useState(() => loadStored('cv-dock-height', 280))
  const [showHealthModal, setShowHealthModal] = useState(false)
  const [isCarouselLocked, setIsCarouselLocked] = useState(false)
  const isInitialLoadRef = useRef(true)
  const formRef = useRef<HTMLFormElement>(null)
  const appShellRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const carouselDirectionRef = useRef<'next' | 'prev'>('next')

  const startResize = useCallback(
    (direction: 'left' | 'right', startX: number, startWidth: number): void => {
      let currentWidth = startWidth
      function onMouseMove(e: MouseEvent): void {
        const delta = direction === 'left' ? e.clientX - startX : startX - e.clientX
        currentWidth = Math.min(
          direction === 'left' ? 400 : 500,
          Math.max(direction === 'left' ? 180 : 220, startWidth + delta)
        )
        if (direction === 'left' && appShellRef.current) {
          appShellRef.current.style.gridTemplateColumns = `${currentWidth}px 6px minmax(0, 1fr)`
        } else if (direction === 'right' && contentRef.current) {
          contentRef.current.style.gridTemplateColumns = `1fr 6px ${currentWidth}px`
        }
      }
      function onMouseUp(): void {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.documentElement.classList.remove('is-resizing')
        document.documentElement.style.cursor = ''
        if (direction === 'left') setSidebarWidth(currentWidth)
        else setDetailWidth(currentWidth)
      }
      document.documentElement.classList.add('is-resizing')
      document.documentElement.style.cursor = 'col-resize'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    []
  )

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

  function navigatePreview(direction: 'prev' | 'next'): void {
    if (!selectedEntry || selectedEntry.previewImages.length === 0) {
      return
    }
    carouselDirectionRef.current = direction
    const images = selectedEntry.previewImages
    setSelectedPreviewId((currentId) => {
      const currentIndex = images.findIndex((img) => img.id === currentId)
      const nextIndex =
        direction === 'prev'
          ? (currentIndex - 1 + images.length) % images.length
          : (currentIndex + 1) % images.length
      return images[nextIndex].id
    })
  }

  const healthSummary = useMemo(() => {
    if (!pathHealth) {
      return 'Unknown'
    }
    const issues: string[] = []
    if (!pathHealth.rootPathExists) issues.push('root missing')
    if (!pathHealth.entryFileExists) issues.push('entry file missing')
    if (pathHealth.missingPreviewImages.length > 0)
      issues.push(`${pathHealth.missingPreviewImages.length} missing preview(s)`)
    return issues.length === 0 ? 'Healthy' : issues.join(', ')
  }, [pathHealth])

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

  const relationshipCountMap = useMemo(
    () => new Map(entryOptions.map((e) => [e.id, e.relationshipCount])),
    [entryOptions]
  )

  const archivedCount = useMemo(
    () => entryOptions.filter((e) => e.status === 'archived').length,
    [entryOptions]
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

        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false
          return null
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
    document.documentElement.dataset.theme = themeMode
    window.localStorage.setItem('code-vault-theme', themeMode)
  }, [themeMode])

  useEffect(() => {
    if (carouselInterval === null) {
      window.localStorage.removeItem('code-vault-carousel-speed')
    } else {
      window.localStorage.setItem('code-vault-carousel-speed', String(carouselInterval))
    }
  }, [carouselInterval])

  useEffect(() => {
    window.localStorage.setItem('cv-selected-id', JSON.stringify(selectedId))
  }, [selectedId])

  useEffect(() => {
    window.localStorage.setItem('cv-filters', JSON.stringify(filters))
  }, [filters])

  useEffect(() => {
    window.localStorage.setItem('cv-sidebar-width', JSON.stringify(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('cv-detail-width', JSON.stringify(detailWidth))
  }, [detailWidth])

  useEffect(() => {
    window.localStorage.setItem('cv-compact-grid', JSON.stringify(compactGrid))
  }, [compactGrid])

  useEffect(() => {
    window.localStorage.setItem('cv-dock-tabs', JSON.stringify(openDockTabs))
    window.localStorage.setItem('cv-dock-active', JSON.stringify(activeDockTab))
    window.localStorage.setItem('cv-dock-collapsed', JSON.stringify(isDockCollapsed))
    window.localStorage.setItem('cv-dock-layout', JSON.stringify(dockLayoutMode))
    window.localStorage.setItem('cv-dock-height', JSON.stringify(dockHeight))
  }, [openDockTabs, activeDockTab, isDockCollapsed, dockLayoutMode, dockHeight])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 5000)
    return () => clearTimeout(timer)
  }, [error])

  const filtersInitRef = useRef(true)
  useEffect(() => {
    if (filtersInitRef.current) {
      filtersInitRef.current = false
      return
    }
    void refreshEntries(filters)
  }, [filters])

  useEffect(() => {
    if (carouselInterval === null || isCarouselLocked || !selectedEntry || selectedEntry.previewImages.length < 2) return
    const images = selectedEntry.previewImages
    const timer = setInterval(() => {
      carouselDirectionRef.current = 'next'
      setSelectedPreviewId((currentId) => {
        const currentIndex = images.findIndex((img) => img.id === currentId)
        const nextIndex = (currentIndex + 1) % images.length
        return images[nextIndex].id
      })
    }, carouselInterval * 1000)
    return () => clearInterval(timer)
  }, [carouselInterval, isCarouselLocked, selectedEntry?.id, selectedEntry?.previewImages.length])

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
      setSelectedPreviewId(null)
      setRelationshipDraft({
        targetEntryId: '',
        relationshipType: relationshipTypes[0]
      })
      return
    }

    setSelectedPreviewId(selectedEntry.previewImages[0]?.id ?? null)
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

  function toggleThemeMode(): void {
    setThemeMode((current) => (current === 'light' ? 'dark' : 'light'))
  }

  function closeOverlay(): void {
    setActiveOverlay(null)
    setActiveNavSection('browse')
  }

  function openDockTab(tabId: DockTabId): void {
    setOpenDockTabs((current) => (current.includes(tabId) ? current : [...current, tabId]))
    setActiveDockTab(tabId)
    setIsDockCollapsed(false)
    const navMap: Record<DockTabId, NavSection> = { import: 'import', bulkRepair: 'repair', portability: 'portability' }
    setActiveNavSection(navMap[tabId])
  }

  function closeDockTab(tabId: DockTabId): void {
    setOpenDockTabs((current) => {
      const next = current.filter((id) => id !== tabId)
      if (next.length === 0) {
        setIsDockCollapsed(true)
        setActiveDockTab(null)
        setActiveNavSection('browse')
      } else if (activeDockTab === tabId) {
        setActiveDockTab(next[next.length - 1])
      }
      return next
    })
  }

  function toggleDockCollapse(): void {
    setIsDockCollapsed((current) => !current)
  }

  function focusDockTab(tabId: DockTabId): void {
    setActiveDockTab(tabId)
    if (isDockCollapsed) setIsDockCollapsed(false)
  }

  const startDockResize = useCallback(
    (startY: number, startHeight: number): void => {
      function onMouseMove(e: MouseEvent): void {
        const delta = startY - e.clientY
        setDockHeight(Math.min(600, Math.max(120, startHeight + delta)))
      }
      function onMouseUp(): void {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.documentElement.classList.remove('is-resizing')
        document.documentElement.style.cursor = ''
      }
      document.documentElement.classList.add('is-resizing')
      document.documentElement.style.cursor = 'row-resize'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    []
  )

  function openCreateOverlay(): void {
    resetCreateForm()
    setFormError('')
    setActiveNavSection('browse')
    setActiveOverlay('entry')
  }

  function resetCreateForm(): void {
    setFormMode('create')
    setDraft(defaultEntryDraft)
  }

  function startEdit(): void {
    if (!selectedEntry) {
      return
    }

    setFormMode('edit')
    setFormError('')
    setDraft(normalizeDraft(selectedEntry))
    setActiveOverlay('entry')
    setActiveNavSection('browse')
  }

  function updateDraft(nextDraft: EntryDraft): void {
    setDraft(syncPreviewPath(nextDraft))
  }

  function handleAccordionToggle(id: string, isOpen: boolean): void {
    if (isOpen) {
      setOpenAccordion(id)
    } else {
      setOpenAccordion((current) => (current === id ? null : current))
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setNotice('')

    if (!draft.title.trim() || !draft.rootPath.trim()) {
      setFormError('Title and root path are required.')
      return
    }

    setIsSaving(true)
    setFormError('')

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
      setActiveOverlay(null)
      setActiveNavSection('browse')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save entry.')
    } finally {
      setIsSaving(false)
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

  async function handleUnarchive(): Promise<void> {
    if (!selectedEntry) {
      return
    }

    try {
      await vaultApi.patchEntry(selectedEntry.id, { status: 'draft' })
      setNotice('Entry unarchived.')
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
    } catch (unarchiveError) {
      setError(unarchiveError instanceof Error ? unarchiveError.message : 'Failed to unarchive entry.')
    }
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
    openDockTab('portability')

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
      closeDockTab('portability')
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
    openDockTab('portability')

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
      closeDockTab('portability')
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

  async function handlePasteClipboardImage(): Promise<void> {
    if (!selectedEntry || isManagingPreviews) {
      return
    }

    setIsManagingPreviews(true)
    try {
      const updated = await vaultApi.pasteClipboardImage(selectedEntry.id)
      const lastPreview = updated.previewImages[updated.previewImages.length - 1]
      if (lastPreview) {
        setSelectedPreviewId(lastPreview.id)
      }
      setSelectedId(updated.id)
      await Promise.all([refreshEntries(filters), refreshReferenceData()])
      setNotice('Preview pasted from clipboard.')
    } catch (pasteError) {
      const message = pasteError instanceof Error ? pasteError.message : String(pasteError)
      if (!message.includes('No image found on the clipboard')) {
        setError(message || 'Failed to paste clipboard image.')
      }
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
    openDockTab('import')

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
    openDockTab('import')

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
        closeDockTab('import')
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
      closeDockTab('bulkRepair')
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

  function renderImportDockContent(): ReactElement {
    return (
      <div>
        <p className="detail-notes" style={{ marginBottom: 8 }}>
          Scan existing folders or files, review detected metadata and preview ordering, then save
          only the entries you want.
        </p>
        <div className="action-grid" style={{ marginBottom: 8 }}>
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
          <p className="detail-notes">
            {acceptedImportCount} of {importCandidates.length} candidate
            {importCandidates.length === 1 ? '' : 's'} set to keep.
          </p>
        ) : null}
      </div>
    )
  }

  function renderBulkRepairDockContent(): ReactElement {
    return (
      <div>
        <p className="detail-notes" style={{ marginBottom: 8 }}>
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
      </div>
    )
  }

  function renderPortabilityDockContent(): ReactElement {
    return (
      <div>
        <p className="detail-notes" style={{ marginBottom: 8 }}>
          Create portable entry bundles, full vault backups, and restore packages on another
          machine without leaving the app.
        </p>
        <div className="action-grid" style={{ marginBottom: 8 }}>
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
          <p className="detail-notes">{lastPortabilityResult}</p>
        ) : null}
      </div>
    )
  }

  function renderDockTabContent(tabId: DockTabId): ReactElement {
    switch (tabId) {
      case 'import':
        return renderImportDockContent()
      case 'bulkRepair':
        return renderBulkRepairDockContent()
      case 'portability':
        return renderPortabilityDockContent()
    }
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
                  <PreviewMedia alt={`${entry.title} preview`} src={entry.previewImagePath} />
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

  const dockTabLabels: Record<DockTabId, string> = {
    import: 'Import Projects',
    bulkRepair: 'Bulk Repair',
    portability: 'Portability'
  }

  const dockHelpMap: Record<DockTabId, string> = {
    import: 'importing',
    bulkRepair: 'repair',
    portability: 'backup-restore'
  }

  const accordionHelpMap: Record<string, string> = {
    'quick-actions': 'run-command',
    'file-preview': 'file-preview',
    'gallery': 'previews',
    'related': 'relationships',
    'duplicates': 'repair',
    'template-dup': 'templates'
  }

  function openHelpTo(sectionId: string): void {
    setShowHelpGuide(sectionId)
  }

  const activeTopbarCopy = useMemo(() => {
    if (activeDockTab && !isDockCollapsed) {
      return { eyebrow: 'Workspace', title: dockTabLabels[activeDockTab] }
    }
    return { eyebrow: 'Vault', title: 'Browse All' }
  }, [activeDockTab, isDockCollapsed])

  return (
    <div ref={appShellRef} className="app-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}>
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">Local-first desktop vault</p>
          <h1>Code Vault</h1>
          <p className="lede">Your curated code archive.</p>
        </div>

        <section className="panel nav-panel">
          <p className="panel-label">Workspace Tools</p>
          <div className="nav-list">
            <button
              className={`nav-button ${activeDockTab === 'import' && !isDockCollapsed ? 'active' : ''}`}
              type="button"
              onClick={() => openDockTab('import')}
            >
              <span className="material-symbols-outlined nav-icon">file_upload</span>
              <span>Import</span>
            </button>
            <button
              className={`nav-button ${activeDockTab === 'bulkRepair' && !isDockCollapsed ? 'active' : ''}`}
              type="button"
              onClick={() => openDockTab('bulkRepair')}
            >
              <span className="material-symbols-outlined nav-icon">build</span>
              <span>Bulk Repair</span>
            </button>
            <button
              className={`nav-button ${activeDockTab === 'portability' && !isDockCollapsed ? 'active' : ''}`}
              type="button"
              onClick={() => openDockTab('portability')}
            >
              <span className="material-symbols-outlined nav-icon">move_down</span>
              <span>Portability</span>
            </button>
          </div>
        </section>

        <section className="panel browse-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-label">Filters</p>
              <h2>Browse vault</h2>
            </div>
            <div className="inline-actions">
              <button
                className="card-icon-btn"
                type="button"
                title="Refresh"
                onClick={() => void refreshEntries(filters)}
              >
                <span className="material-symbols-outlined">refresh</span>
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setFilters(defaultFilters)}
              >
                Reset
              </button>
            </div>
          </div>

          <label className="field">
            <span>Search title or tags</span>
            <input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search by title, tag, or stack"
            />
          </label>

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
              <span>Archived{archivedCount > 0 ? ` (${archivedCount})` : ''}</span>
            </label>

            <label className="checkbox-field">
              <input
                checked={filters.onlyFavorites}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, onlyFavorites: event.target.checked }))
                }
              />
              <span>Favorites</span>
            </label>

            <label className="checkbox-field">
              <input
                checked={filters.onlyPinned}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, onlyPinned: event.target.checked }))
                }
              />
              <span>Pinned</span>
            </label>

            <label className="checkbox-field">
              <input
                checked={filters.onlyTemplates}
                type="checkbox"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, onlyTemplates: event.target.checked }))
                }
              />
              <span>Templates</span>
            </label>
          </div>
        </section>
      </aside>

      <div
        className="resize-handle resize-handle-left"
        onMouseDown={(e) => startResize('left', e.clientX, sidebarWidth)}
      />

      <main ref={contentRef} className="content" style={{ gridTemplateColumns: `1fr 6px ${detailWidth}px` }}>
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">{activeTopbarCopy.eyebrow}</p>
            <h2>{activeTopbarCopy.title}</h2>
          </div>
          <div className="topbar-actions">
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setShowHelpGuide('layout')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: 'middle', marginRight: 4 }}>help</span>
              <span>Open Guide</span>
            </button>
            <button className="theme-toggle" type="button" onClick={toggleThemeMode}>
              <span>{themeMode === 'light' ? '\u263E Dark' : '\u2600 Light'}</span>
            </button>
            <button className="primary-button topbar-button" type="button" onClick={openCreateOverlay}>
              New entry
            </button>
          </div>
        </header>

        <section className="toolbar">
          <div>
            <p className="eyebrow">Vault overview</p>
            <h2>{entries.length} visible item{entries.length === 1 ? '' : 's'}</h2>
          </div>
          <div className="status-area">
            <button
              className={`card-icon-btn ${compactGrid ? 'active' : ''}`}
              type="button"
              title={compactGrid ? 'Show fewer, larger cards' : 'Show more, smaller cards'}
              onClick={() => setCompactGrid((c) => !c)}
            >
              <span className="material-symbols-outlined">{compactGrid ? 'grid_view' : 'apps'}</span>
            </button>
          </div>
        </section>

        {entryBundleInspection ? (
          <>
          <div className="workflow-review-backdrop" onClick={() => setEntryBundleInspection(null)} />
          <section className="import-review-panel portability-review-panel workflow-review-panel active">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Portability review</p>
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
                  className="card-icon-btn"
                  type="button"
                  title="Dismiss"
                  onClick={() => setEntryBundleInspection(null)}
                >
                  <span className="material-symbols-outlined">close</span>
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
          </>
        ) : null}

        {vaultBackupInspection ? (
          <>
          <div className="workflow-review-backdrop" onClick={() => setVaultBackupInspection(null)} />
          <section className="import-review-panel portability-review-panel workflow-review-panel active">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Portability review</p>
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
                  className="card-icon-btn"
                  type="button"
                  title="Dismiss"
                  onClick={() => setVaultBackupInspection(null)}
                >
                  <span className="material-symbols-outlined">close</span>
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
          </>
        ) : null}

        {importCandidates.length > 0 ? (
          <>
          <div className="workflow-review-backdrop" onClick={() => setImportCandidates([])} />
          <section className="import-review-panel workflow-review-panel active">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Import review</p>
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
                <button className="card-icon-btn" type="button" title="Dismiss" onClick={() => setImportCandidates([])}>
                  <span className="material-symbols-outlined">close</span>
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
          </>
        ) : null}

        <section className="workspace">
          <section className="vault-workspace">
          <div className="vault-scroll">
            {isLoading ? <div className="empty-state">Loading your vault...</div> : null}

            {!isLoading && entries.length === 0 ? (
              <div className="empty-state">
                <h3>No entries yet</h3>
                <p>Add your first item or import an existing project to start building your vault.</p>
              </div>
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
                          <PreviewMedia alt={`${entry.title} preview`} src={entry.previewImagePath} />
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
                            {relationshipCountMap.get(entry.id) ? (
                              <span className="chip subtle">
                                <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: 2 }}>link</span>
                                {relationshipCountMap.get(entry.id)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {!isLoading && entries.length > 0 ? (
              <div className={`card-grid ${compactGrid ? 'cols-4' : ''}`}>
                {entries.map((entry) => (
                  <article
                    key={entry.id}
                    className={`entry-card ${selectedId === entry.id ? 'selected' : ''}`}
                  >
                    <div className="entry-card-shell" onClick={() => setSelectedId(entry.id)}>
                      {entry.previewImagePath && !entry.previewImages[0]?.isMissing ? (
                        <PreviewMedia alt={`${entry.title} preview`} src={entry.previewImagePath} />
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
                          {relationshipCountMap.get(entry.id) ? (
                            <span className="chip subtle">
                              <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: 2 }}>link</span>
                              {relationshipCountMap.get(entry.id)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="card-controls">
                      <button
                        className={`card-icon-btn ${entry.isFavorite ? 'active' : ''}`}
                        type="button"
                        title={entry.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        onClick={() =>
                          void handleToggleFlag(
                            entry,
                            'isFavorite',
                            entry.isFavorite ? 'Removed from favorites.' : 'Added to favorites.'
                          )
                        }
                      >
                        <span className="material-symbols-outlined">star</span>
                      </button>
                      <button
                        className={`card-icon-btn ${entry.isPinned ? 'active' : ''}`}
                        type="button"
                        title={entry.isPinned ? 'Unpin' : 'Pin'}
                        onClick={() =>
                          void handleToggleFlag(
                            entry,
                            'isPinned',
                            entry.isPinned ? 'Entry unpinned.' : 'Entry pinned.'
                          )
                        }
                      >
                        <span className="material-symbols-outlined">push_pin</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          {openDockTabs.length > 0 && !isDockCollapsed ? (
            <>
              <div
                className="dock-resize-handle"
                onMouseDown={(e) => startDockResize(e.clientY, dockHeight)}
              />
              <div className="dock-panel" style={{ height: dockHeight }}>
                <div className="dock-header">
                  <div className="dock-tabs">
                    {openDockTabs.map((tabId) => (
                      <div key={tabId} className={`dock-tab ${activeDockTab === tabId ? 'active' : ''}`}>
                        <span
                          style={{ cursor: 'pointer' }}
                          onClick={() => focusDockTab(tabId)}
                        >
                          {dockTabLabels[tabId]}
                        </span>
                        <button
                          className="dock-tab-close"
                          type="button"
                          title="Close tab"
                          onClick={() => closeDockTab(tabId)}
                        >
                          <span className="material-symbols-outlined">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="dock-header-actions">
                    {activeDockTab ? (
                      <button
                        className="card-icon-btn help-context-btn"
                        type="button"
                        title="Help"
                        onClick={() => openHelpTo(dockHelpMap[activeDockTab])}
                      >
                        <span className="material-symbols-outlined">help</span>
                      </button>
                    ) : null}
                    <button
                      className="card-icon-btn"
                      type="button"
                      title={dockLayoutMode === 'focused' ? 'Split view' : 'Focused view'}
                      onClick={() => setDockLayoutMode((m) => (m === 'focused' ? 'split' : 'focused'))}
                    >
                      <span className="material-symbols-outlined">
                        {dockLayoutMode === 'focused' ? 'vertical_split' : 'crop_square'}
                      </span>
                    </button>
                    <button
                      className="card-icon-btn"
                      type="button"
                      title="Collapse dock"
                      onClick={toggleDockCollapse}
                    >
                      <span className="material-symbols-outlined">expand_more</span>
                    </button>
                  </div>
                </div>
                {dockLayoutMode === 'focused' && activeDockTab ? (
                  <div className="dock-content">
                    {renderDockTabContent(activeDockTab)}
                  </div>
                ) : (
                  <div className="dock-split">
                    {openDockTabs.map((tabId) => (
                      <div key={tabId} className="dock-content">
                        {renderDockTabContent(tabId)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
          </section>

          <div
            className="resize-handle resize-handle-right"
            onMouseDown={(e) => startResize('right', e.clientX, detailWidth)}
          />

          <section className="detail-panel">
            {selectedEntry ? (
              <>
                {/* 1. Gallery with hover controls (scrolls away) */}
                <div className="detail-preview detail-gallery">
                  {selectedEntry.previewImages.length > 0 ? (
                    selectedEntry.previewImages.map((image) => (
                      <div
                        key={image.id}
                        className={`detail-preview-slide${image.id === selectedPreviewId || (!selectedPreviewId && image.order === 0) ? ` slide-${carouselDirectionRef.current} active-slide` : ''}`}
                        style={image.id === selectedPreviewId || (!selectedPreviewId && image.order === 0) ? undefined : { position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
                      >
                        {image.isMissing ? (
                          <div className="preview-placeholder large">Missing preview</div>
                        ) : (
                          <PreviewMedia
                            alt={`${selectedEntry.title} preview`}
                            src={image.path}
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="detail-preview-slide active-slide">
                      <div className="preview-placeholder large">{selectedEntry.type}</div>
                    </div>
                  )}
                  <div className="gallery-hover-controls">
                    <button type="button" title="Previous" onClick={() => navigatePreview('prev')}>
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>
                    <button type="button" title="Next" onClick={() => navigatePreview('next')}>
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
                    {selectedEntry.previewImages.length >= 2 ? (
                      <button
                        type="button"
                        title={isCarouselLocked ? 'Unlock carousel' : 'Lock on this image'}
                        onClick={() => setIsCarouselLocked((l) => !l)}
                      >
                        <span className="material-symbols-outlined">{isCarouselLocked ? 'lock' : 'lock_open'}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="Add preview"
                      onClick={() => void handleAttachPreviewToEntry()}
                    >
                      <span className="material-symbols-outlined">add</span>
                    </button>
                    <button
                      type="button"
                      title="Paste preview from clipboard (Ctrl+V)"
                      disabled={isManagingPreviews}
                      onClick={() => void handlePasteClipboardImage()}
                    >
                      <span className="material-symbols-outlined">content_paste</span>
                    </button>
                    <button
                      type="button"
                      title="Remove preview"
                      disabled={!selectedPreview || isManagingPreviews}
                      onClick={() =>
                        selectedPreview
                          ? void handleRemoveEntryPreview(selectedPreview.id)
                          : undefined
                      }
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>

                <div className="detail-sticky-header">
                {/* 2. Header with icon buttons */}
                <div className="detail-header">
                  <p className="eyebrow">Item detail</p>
                  <div className="detail-actions">
                    <button
                      className="card-icon-btn"
                      type="button"
                      title="Edit"
                      onClick={startEdit}
                    >
                      <span className="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      className={`card-icon-btn ${selectedEntry.isFavorite ? 'active' : ''}`}
                      type="button"
                      title={selectedEntry.isFavorite ? 'Unfavorite' : 'Favorite'}
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
                      <span className="material-symbols-outlined">star</span>
                    </button>
                    <button
                      className={`card-icon-btn ${selectedEntry.isPinned ? 'active' : ''}`}
                      type="button"
                      title={selectedEntry.isPinned ? 'Unpin' : 'Pin'}
                      onClick={() =>
                        void handleToggleFlag(
                          selectedEntry,
                          'isPinned',
                          selectedEntry.isPinned ? 'Entry unpinned.' : 'Entry pinned.'
                        )
                      }
                    >
                      <span className="material-symbols-outlined">push_pin</span>
                    </button>
                  </div>
                </div>
                <h2>{selectedEntry.title}</h2>

                {/* 3. Compact metadata line */}
                <div className="detail-meta-line">
                  <span className="chip">{selectedEntry.type}</span>
                  <span className="chip">{selectedEntry.status}</span>
                  {selectedEntry.stack ? <span className="chip">{selectedEntry.stack}</span> : null}
                  {relationships.length > 0 ? (
                    <span className="chip subtle">
                      <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: 2 }}>link</span>
                      {relationships.length}
                    </span>
                  ) : null}
                </div>

                {/* 4. Description (clamped) */}
                <p className="detail-description detail-description-clamp">
                  {selectedEntry.description || 'No description saved for this entry yet.'}
                </p>
                </div>

                {/* 5. Quick Actions accordion */}
                <details className="detail-accordion" open={openAccordion === 'quick-actions'} onToggle={(e) => handleAccordionToggle('quick-actions', (e.target as HTMLDetailsElement).open)}>
                  <summary>
                    <h3>Quick actions</h3>
                    {openAccordion === 'quick-actions' ? (
                      <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={(e) => { e.stopPropagation(); openHelpTo(accordionHelpMap['quick-actions']) }}>
                        <span className="material-symbols-outlined">help</span>
                      </button>
                    ) : null}
                    <span className="material-symbols-outlined accordion-indicator">expand_more</span>
                  </summary>
                  <div className="detail-accordion-body">
                    <div className="detail-quick-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleOpenPath(selectedEntry.rootPath, 'Root path')}
                      >
                        Open root
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!selectedEntry.entryFilePath}
                        onClick={() => void handleOpenPath(selectedEntry.entryFilePath, 'Entry file')}
                      >
                        Open file
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
                        Copy path
                      </button>
                    </div>
                    <div className="detail-quick-actions" style={{ marginTop: 6 }}>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={!selectedEntry.entryFilePath}
                        onClick={() =>
                          void handleCopy(selectedEntry.entryFilePath, 'Entry file path')
                        }
                      >
                        Copy entry file
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
                        Open preview
                      </button>
                    </div>
                  </div>
                </details>

                {/* 6. File Preview accordion (default closed) */}
                <details className="detail-accordion" open={openAccordion === 'file-preview'} onToggle={(e) => handleAccordionToggle('file-preview', (e.target as HTMLDetailsElement).open)}>
                  <summary>
                    <h3>File preview</h3>
                    <button
                      className="card-icon-btn"
                      type="button"
                      title="View full"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowFilePreviewModal(true)
                      }}
                    >
                      <span className="material-symbols-outlined">open_in_full</span>
                    </button>
                    {openAccordion === 'file-preview' ? (
                      <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={(e) => { e.stopPropagation(); openHelpTo(accordionHelpMap['file-preview']) }}>
                        <span className="material-symbols-outlined">help</span>
                      </button>
                    ) : null}
                    <span className="chip subtle">
                      {detailPreviewInspection?.files.length ?? 0} file
                      {(detailPreviewInspection?.files.length ?? 0) === 1 ? '' : 's'}
                    </span>
                    <span className="material-symbols-outlined accordion-indicator">expand_more</span>
                  </summary>
                  <div className="detail-accordion-body">
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
                </details>

                {/* 8. Health & Portability button → opens modal */}
                <button
                  className="ghost-button"
                  type="button"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'space-between' }}
                  onClick={() => setShowHealthModal(true)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>monitor_heart</span>
                    Health &amp; Portability
                  </span>
                  <span className="chip subtle">{healthSummary}</span>
                </button>

                {/* 9. Preview Gallery accordion (default closed) */}
                <details className="detail-accordion" open={openAccordion === 'gallery'} onToggle={(e) => handleAccordionToggle('gallery', (e.target as HTMLDetailsElement).open)}>
                  <summary>
                    <h3>Preview gallery</h3>
                    <span className="chip subtle">{selectedEntry.previewImages.length}</span>
                    {openAccordion === 'gallery' ? (
                      <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={(e) => { e.stopPropagation(); openHelpTo(accordionHelpMap['gallery']) }}>
                        <span className="material-symbols-outlined">help</span>
                      </button>
                    ) : null}
                    <span className="material-symbols-outlined accordion-indicator">expand_more</span>
                  </summary>
                  <div className="detail-accordion-body">
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
                    {selectedEntry.previewImages.length >= 2 ? (
                      <div className="carousel-controls">
                        <label>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 2 }}>slideshow</span>
                          {carouselInterval === null ? 'Off' : `${carouselInterval}s`}
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={5}
                          step={0.5}
                          value={carouselInterval ?? 0}
                          onChange={(e) => {
                            const val = Number(e.target.value)
                            setCarouselInterval(val === 0 ? null : val)
                          }}
                          title={carouselInterval === null ? 'Carousel off — drag to set speed' : `Carousel speed: ${carouselInterval}s per slide`}
                        />
                        {selectedEntry.previewImages.length >= 2 ? (
                          <button
                            className="card-icon-btn"
                            type="button"
                            title={isCarouselLocked ? 'Unlock carousel' : 'Lock on current image'}
                            onClick={() => setIsCarouselLocked((l) => !l)}
                          >
                            <span className="material-symbols-outlined">{isCarouselLocked ? 'lock' : 'lock_open'}</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="inline-actions" style={{ marginTop: 6 }}>
                      <button
                        className="card-icon-btn"
                        disabled={isManagingPreviews}
                        type="button"
                        title="Add preview"
                        onClick={() => void handleAttachPreviewToEntry()}
                      >
                        <span className="material-symbols-outlined">add</span>
                      </button>
                      <button
                        className="card-icon-btn"
                        disabled={isManagingPreviews}
                        type="button"
                        title="Paste preview from clipboard"
                        onClick={() => void handlePasteClipboardImage()}
                      >
                        <span className="material-symbols-outlined">content_paste</span>
                      </button>
                      <button
                        className="card-icon-btn"
                        disabled={!selectedPreview || isManagingPreviews}
                        type="button"
                        title="Move left"
                        onClick={() =>
                          selectedPreview
                            ? void handleMoveEntryPreview(selectedPreview.id, 'left')
                            : undefined
                        }
                      >
                        <span className="material-symbols-outlined">chevron_left</span>
                      </button>
                      <button
                        className="card-icon-btn"
                        disabled={!selectedPreview || isManagingPreviews}
                        type="button"
                        title="Move right"
                        onClick={() =>
                          selectedPreview
                            ? void handleMoveEntryPreview(selectedPreview.id, 'right')
                            : undefined
                        }
                      >
                        <span className="material-symbols-outlined">chevron_right</span>
                      </button>
                      <button
                        className="card-icon-btn"
                        disabled={!selectedPreview || isManagingPreviews}
                        type="button"
                        title="Remove"
                        onClick={() =>
                          selectedPreview
                            ? void handleRemoveEntryPreview(selectedPreview.id)
                            : undefined
                        }
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                    <details className="preview-path-details">
                      <summary>Show file paths</summary>
                      {renderPreviewEditor(
                        selectedEntry.previewImages,
                        (previewId, direction) => void handleMoveEntryPreview(previewId, direction),
                        (previewId) => void handleRemoveEntryPreview(previewId)
                      )}
                    </details>
                  </div>
                </details>

                {/* 10. Related Items accordion (default closed) */}
                <details className="detail-accordion" open={openAccordion === 'related'} onToggle={(e) => handleAccordionToggle('related', (e.target as HTMLDetailsElement).open)}>
                  <summary>
                    <h3>Related items</h3>
                    <span className="chip subtle">{relationships.length}</span>
                    {openAccordion === 'related' ? (
                      <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={(e) => { e.stopPropagation(); openHelpTo(accordionHelpMap['related']) }}>
                        <span className="material-symbols-outlined">help</span>
                      </button>
                    ) : null}
                    <span className="material-symbols-outlined accordion-indicator">expand_more</span>
                  </summary>
                  <div className="detail-accordion-body">
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
                </details>

                {/* 11. Duplicate Warnings accordion (only if matches exist, default closed) */}
                {duplicateInspection.matches.length > 0 ? (
                  <details className="detail-accordion" open={openAccordion === 'duplicates'} onToggle={(e) => handleAccordionToggle('duplicates', (e.target as HTMLDetailsElement).open)}>
                    <summary>
                      <h3>Duplicate warnings</h3>
                      <span className="chip warning">{duplicateInspection.matches.length}</span>
                      {openAccordion === 'duplicates' ? (
                        <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={(e) => { e.stopPropagation(); openHelpTo(accordionHelpMap['duplicates']) }}>
                          <span className="material-symbols-outlined">help</span>
                        </button>
                      ) : null}
                      <span className="material-symbols-outlined accordion-indicator">expand_more</span>
                    </summary>
                    <div className="detail-accordion-body">
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
                    </div>
                  </details>
                ) : null}

                {/* 12. Template Duplication accordion (only if isTemplate, default closed) */}
                {selectedEntry.isTemplate ? (
                  <details className="detail-accordion" open={openAccordion === 'template-dup'} onToggle={(e) => handleAccordionToggle('template-dup', (e.target as HTMLDetailsElement).open)}>
                    <summary>
                      <h3>Template duplication</h3>
                      {openAccordion === 'template-dup' ? (
                        <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={(e) => { e.stopPropagation(); openHelpTo(accordionHelpMap['template-dup']) }}>
                          <span className="material-symbols-outlined">help</span>
                        </button>
                      ) : null}
                      <span className="material-symbols-outlined accordion-indicator">expand_more</span>
                    </summary>
                    <div className="detail-accordion-body">
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
                    </div>
                  </details>
                ) : null}

                {/* 13. Danger zone */}
                <div className="detail-danger-zone">
                  {selectedEntry.status === 'archived' ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleUnarchive()}
                    >
                      Unarchive
                    </button>
                  ) : (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleArchive()}
                    >
                      Archive
                    </button>
                  )}
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => void handleDelete()}
                  >
                    Delete
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
                </div>

                {/* 14. Footer */}
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

      {showFilePreviewModal && selectedEntry ? (
        <div className="file-preview-modal-backdrop" onClick={() => setShowFilePreviewModal(false)}>
          <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header" style={{ marginBottom: 12 }}>
              <h3>File Preview — {detailPreview?.relativePath ?? 'No file'}</h3>
              <button className="card-icon-btn" type="button" onClick={() => setShowFilePreviewModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {detailPreview?.content ? (
              detailPreviewPath.endsWith('.md') ? (
                <div
                  className="markdown-preview"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(detailPreview.content) }}
                />
              ) : (
                <div className="quick-preview-output">
                  <pre>{detailPreview.content}</pre>
                </div>
              )
            ) : (
              <p className="detail-notes">No preview content available.</p>
            )}
          </div>
        </div>
      ) : null}

      {showHealthModal && selectedEntry ? (
        <div className="health-modal-backdrop" onClick={() => setShowHealthModal(false)}>
          <div className="health-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-header" style={{ marginBottom: 12 }}>
              <h3>Health &amp; Portability</h3>
              <div className="inline-actions">
                <button className="card-icon-btn help-context-btn" type="button" title="Help" onClick={() => openHelpTo('repair')}>
                  <span className="material-symbols-outlined">help</span>
                </button>
                <button className="card-icon-btn" type="button" onClick={() => setShowHealthModal(false)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <p className="detail-notes" style={{ marginBottom: 8 }}>
              Checks if your project files are still where you saved them. Use the export buttons to share or back up this entry.
            </p>
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
                <div className="inline-actions" style={{ marginBottom: 8 }}>
                  <button className="ghost-button" type="button" onClick={() => void handleRelinkRoot()}>
                    Relink root
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handleRelinkEntryFile()}>
                    Relink entry file
                  </button>
                </div>
                {pathHealth.missingPreviewImages.length > 0 ? (
                  <div className="relationship-list" style={{ marginBottom: 8 }}>
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
            <div className="action-grid" style={{ marginTop: 8 }}>
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
        </div>
      ) : null}

      {activeOverlay === 'entry' ? (
        <div className="entry-form-backdrop" onClick={closeOverlay}>
          <div className="entry-form-modal" onClick={(e) => e.stopPropagation()}>
            <div className="entry-form-sticky-header">
            <div className="detail-header">
              <h3>{formMode === 'create' ? 'New entry' : 'Edit entry'}</h3>
              <div className="inline-actions">
                <button className="ghost-button" type="button" onClick={() => void handleRefreshMetadata()}>
                  {isDetectingMetadata ? 'Detecting...' : 'Detect metadata'}
                </button>
                <button
                  className="primary-button"
                  disabled={isSaving}
                  type="button"
                  onClick={() => formRef.current?.requestSubmit()}
                >
                  {isSaving ? 'Saving...' : formMode === 'create' ? 'Save entry' : 'Update entry'}
                </button>
                <button className="card-icon-btn" type="button" onClick={closeOverlay}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            </div>

            <div className="vault-reminder" style={{ marginBottom: 12 }}>
              <span className="material-symbols-outlined vault-reminder-icon">info</span>
              <p>
                Code Vault saves a <strong>link</strong> to your project folder — it does not copy or move your files.
                Your project stays exactly where it is. If you set a <strong>Run command</strong>, you can launch it
                straight from the vault.
              </p>
            </div>

            <form ref={formRef} className="entry-form" onSubmit={(event) => void handleSubmit(event)}>
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

              {formError ? <p className="form-error">{formError}</p> : null}
            </form>
          </div>
        </div>
      ) : null}

      {showHelpGuide ? <HelpGuide initialSectionId={showHelpGuide} onClose={() => setShowHelpGuide(null)} /> : null}

      {(error || notice) ? (
        <div className="toast-container">
          {error ? <div className="toast error">{error}</div> : null}
          {!error && notice ? <div className="toast">{notice}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

export { App }
