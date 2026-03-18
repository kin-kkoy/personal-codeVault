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
  previewImages: [],
  isFavorite: false,
  isPinned: false,
  isTemplate: false,
  notes: '',
  goodFor: '',
  setupNotes: '',
  dependencyNotes: '',
  runCommand: '',
  status: 'draft'
}

export const defaultFilters: EntryFilters = {
  query: '',
  type: 'all',
  status: 'all',
  includeArchived: false,
  onlyFavorites: false,
  onlyPinned: false,
  onlyTemplates: false,
  sortBy: 'updated'
}
