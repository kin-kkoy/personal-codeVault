import type { EntryDraft, EntryFilters } from './types'

export const defaultEntryDraft: EntryDraft = {
  title: '',
  description: '',
  type: 'snippet',
  tags: [],
  stack: '',
  rootPath: '',
  entryFilePath: '',
  previewImagePath: '',
  notes: '',
  status: 'draft'
}

export const defaultFilters: EntryFilters = {
  query: '',
  type: 'all',
  status: 'all',
  includeArchived: false
}
