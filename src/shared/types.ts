export const entryTypes = [
  'snippet',
  'mini-app',
  'component',
  'utility',
  'prompt-output',
  'template',
  'experiment'
] as const

export const entryStatuses = ['draft', 'usable', 'polished', 'archived'] as const

export type EntryType = (typeof entryTypes)[number]
export type EntryStatus = (typeof entryStatuses)[number]

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
  notes: string
  status: EntryStatus
  createdAt: string
  updatedAt: string
}

export type EntryDraft = Omit<VaultEntry, 'id' | 'createdAt' | 'updatedAt'>

export type EntryFilters = {
  query: string
  type: 'all' | EntryType
  status: 'all' | EntryStatus
  includeArchived: boolean
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
  notes: string
  status: EntryStatus
}

export type VaultEntryRecord = Omit<VaultEntry, 'tags'> & {
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

export type VaultApi = {
  listEntries(filters?: Partial<EntryFilters>): Promise<VaultEntry[]>
  getEntry(id: string): Promise<VaultEntry | null>
  createEntry(input: VaultEntryInput): Promise<VaultEntry>
  updateEntry(id: string, input: VaultEntryInput): Promise<VaultEntry>
  archiveEntry(id: string): Promise<void>
  deleteEntry(id: string): Promise<void>
  pickRootPath(): Promise<FileSelection>
  pickEntryFile(): Promise<FileSelection>
  importPreviewImage(): Promise<PreviewImportResult>
  openPath(targetPath: string): Promise<{ success: boolean; message?: string }>
  copyToClipboard(value: string): Promise<void>
}
