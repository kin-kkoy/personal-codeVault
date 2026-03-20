export const entryTypes = [
  'snippet',
  'mini-app',
  'mobile-app',
  'web-app',
  'component',
  'utility',
  'prompt-output',
  'template',
  'experiment'
] as const

export const entryStatuses = ['draft', 'usable', 'polished', 'completed', 'experimental', 'archived'] as const

export const relationshipTypes = [
  'used-in',
  'derived-from',
  'variant-of',
  'pairs-well-with',
  'same-concept'
] as const

export const sortOptions = ['updated', 'created', 'title', 'viewed'] as const

export type EntryType = (typeof entryTypes)[number]
export type EntryStatus = (typeof entryStatuses)[number]
export type RelationshipType = (typeof relationshipTypes)[number]
export type SortOption = (typeof sortOptions)[number]

export type PreviewImage = {
  id: string
  path: string
  order: number
  createdAt: string
  isMissing: boolean
}

export type PathHealth = {
  rootPathExists: boolean
  entryFileExists: boolean
  missingPreviewImages: PreviewImage[]
}

export type DuplicateMatch = {
  type: 'root-path' | 'title' | 'entry-file'
  entryId: string
  title: string
  detail: string
}

export type DuplicateInspection = {
  matches: DuplicateMatch[]
}

export type VaultEntry = {
  id: string
  title: string
  description: string
  type: EntryType
  tags: string[]
  stack: string
  rootPath: string
  entryFilePath: string
  previewImagePath: string
  previewImages: PreviewImage[]
  isFavorite: boolean
  isPinned: boolean
  isTemplate: boolean
  notes: string
  goodFor: string
  setupNotes: string
  dependencyNotes: string
  runCommand: string
  status: EntryStatus
  hasBrokenPaths: boolean
  lastViewedAt: string
  createdAt: string
  updatedAt: string
}

export type EntryDraft = Omit<
  VaultEntry,
  'id' | 'createdAt' | 'updatedAt' | 'hasBrokenPaths' | 'lastViewedAt'
>

export type EntryFilters = {
  query: string
  type: 'all' | EntryType
  status: 'all' | EntryStatus
  includeArchived: boolean
  onlyFavorites: boolean
  onlyPinned: boolean
  onlyTemplates: boolean
  sortBy: SortOption
}

export type VaultEntryInput = {
  title: string
  description: string
  type: EntryType
  tags: string[]
  stack: string
  rootPath: string
  entryFilePath: string
  previewImagePath: string
  previewImages: PreviewImage[]
  isFavorite: boolean
  isPinned: boolean
  isTemplate: boolean
  notes: string
  goodFor: string
  setupNotes: string
  dependencyNotes: string
  runCommand: string
  status: EntryStatus
}

export type InlineEntryPatch = Partial<
  Pick<
    VaultEntryInput,
    | 'title'
    | 'description'
    | 'tags'
    | 'stack'
    | 'status'
    | 'notes'
    | 'goodFor'
    | 'setupNotes'
    | 'dependencyNotes'
  >
>

export type VaultEntryRecord = Omit<VaultEntry, 'tags' | 'previewImages'> & {
  tags: string
}

export type FileSelection = {
  canceled: boolean
  path: string | null
}

export type PreviewImportResult = {
  canceled: boolean
  path: string | null
}

export type PreviewImageCandidate = {
  path: string
  label: string
}

export type PreviewableFile = {
  path: string
  relativePath: string
}

export type QuickPreviewInspection = {
  files: PreviewableFile[]
  defaultPreviewPath: string
}

export type QuickFilePreview = {
  path: string
  relativePath: string
  content: string
  truncated: boolean
  message: string | null
}

export type ImportCandidate = VaultEntryInput & {
  tempId: string
  sourcePath: string
  sourceKind: 'file' | 'folder'
  previewImageCandidates: PreviewImageCandidate[]
  previewableFiles: PreviewableFile[]
  defaultPreviewPath: string
  duplicateRootPath: boolean
}

export type ImportSaveResult = {
  tempId: string
  success: boolean
  message: string
  entry: VaultEntry | null
}

export type EntryOption = Pick<VaultEntry, 'id' | 'title' | 'type' | 'status' | 'isTemplate'> & {
  relationshipCount: number
}

export type EntryRelationship = {
  id: string
  sourceEntryId: string
  targetEntryId: string
  relationshipType: RelationshipType
  createdAt: string
  target: EntryOption & {
    previewImagePath: string
    isFavorite: boolean
    isPinned: boolean
  }
}

export type RelationshipInput = {
  sourceEntryId: string
  targetEntryId: string
  relationshipType: RelationshipType
}

export type TemplateDuplicationInput = {
  templateEntryId: string
  destinationParentPath: string
  newProjectName: string
}

export type RecentActivity = {
  viewed: VaultEntry[]
  created: VaultEntry[]
  updated: VaultEntry[]
}

export type RelinkEntryPathsInput = {
  entryId: string
  newRootPath?: string
  newEntryFilePath?: string
  previewReplacements?: Array<{
    previewId: string
    newSourcePath: string
  }>
}

export type BulkPathRepairInput = {
  oldPrefix: string
  newPrefix: string
}

export type BulkPathRepairResult = {
  updatedEntries: number
  updatedPreviews: number
}

export type PortableExportResult = {
  destinationPath: string
  warnings: string[]
  message: string
}

export type PortableImportResult = {
  successCount: number
  failureCount: number
  importedEntryIds: string[]
  warnings: string[]
  message: string
}

export type EntryBundleInspection = {
  packagePath: string
  displayName: string
  title: string
  type: EntryType
  previewCount: number
  includesSourceFiles: boolean
  sourceFileCount: number
  relationshipCount: number
  warnings: string[]
  duplicateMatches: DuplicateMatch[]
}

export type VaultBackupInspection = {
  packagePath: string
  displayName: string
  entryCount: number
  relationshipCount: number
  previewCount: number
  sourceBundleCount: number
  warnings: string[]
  duplicateMatches: DuplicateMatch[]
}

export type VaultApi = {
  listEntries(filters?: Partial<EntryFilters>): Promise<VaultEntry[]>
  getEntry(id: string): Promise<VaultEntry | null>
  createEntry(input: VaultEntryInput): Promise<VaultEntry>
  updateEntry(id: string, input: VaultEntryInput): Promise<VaultEntry>
  patchEntry(id: string, patch: InlineEntryPatch): Promise<VaultEntry>
  archiveEntry(id: string): Promise<void>
  deleteEntry(id: string): Promise<void>
  listTags(): Promise<string[]>
  listEntryOptions(): Promise<EntryOption[]>
  listRelationships(entryId: string): Promise<EntryRelationship[]>
  createRelationship(input: RelationshipInput): Promise<void>
  deleteRelationship(id: string): Promise<void>
  duplicateTemplate(input: TemplateDuplicationInput): Promise<VaultEntry>
  scanImportCandidate(sourcePath: string): Promise<ImportCandidate>
  scanBatchImportCandidates(parentPath: string): Promise<ImportCandidate[]>
  saveImportCandidates(candidates: ImportCandidate[]): Promise<ImportSaveResult[]>
  refreshMetadata(rootPath: string, entryFilePath: string): Promise<ImportCandidate>
  inspectQuickPreview(rootPath: string, preferredPath: string): Promise<QuickPreviewInspection>
  readQuickPreview(targetPath: string, rootPath: string): Promise<QuickFilePreview>
  listRecentActivity(limit?: number): Promise<RecentActivity>
  markEntryViewed(id: string): Promise<void>
  inspectDuplicates(entryId: string): Promise<DuplicateInspection>
  inspectPathHealth(entryId: string): Promise<PathHealth>
  relinkEntryPaths(input: RelinkEntryPathsInput): Promise<VaultEntry>
  bulkRepairPaths(input: BulkPathRepairInput): Promise<BulkPathRepairResult>
  attachPreviewImageToEntry(entryId: string, sourcePath: string): Promise<VaultEntry>
  removePreviewImage(entryId: string, previewId: string): Promise<VaultEntry>
  movePreviewImage(entryId: string, previewId: string, direction: 'left' | 'right'): Promise<VaultEntry>
  exportEntryMetadata(entryId: string): Promise<PortableExportResult>
  exportEntryBundle(entryId: string): Promise<PortableExportResult>
  inspectEntryBundle(): Promise<EntryBundleInspection | null>
  importEntryBundle(packagePath: string): Promise<PortableImportResult>
  exportVaultBackup(): Promise<PortableExportResult>
  inspectVaultBackup(): Promise<VaultBackupInspection | null>
  restoreVaultBackup(packagePath: string): Promise<PortableImportResult>
  pickRootPath(): Promise<FileSelection>
  pickEntryFile(): Promise<FileSelection>
  importPreviewImage(): Promise<PreviewImportResult>
  openPath(targetPath: string): Promise<{ success: boolean; message?: string }>
  copyToClipboard(value: string): Promise<void>
  runEntryCommand(rootPath: string, command: string): Promise<{ success: boolean; message?: string }>
}
