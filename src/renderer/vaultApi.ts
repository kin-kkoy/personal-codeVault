import { invoke } from '@tauri-apps/api/core'
import type { EntryFilters, VaultApi, VaultEntry, VaultEntryInput } from '@shared/types'

export const vaultApi: VaultApi = {
  listEntries: (filters?: Partial<EntryFilters>) =>
    invoke<VaultEntry[]>('list_entries', { filters: filters ?? null }),
  getEntry: (id: string) => invoke<VaultEntry | null>('get_entry', { id }),
  createEntry: (input: VaultEntryInput) => invoke<VaultEntry>('create_entry', { input }),
  updateEntry: (id: string, input: VaultEntryInput) => invoke<VaultEntry>('update_entry', { id, input }),
  archiveEntry: (id: string) => invoke<void>('archive_entry', { id }),
  deleteEntry: (id: string) => invoke<void>('delete_entry', { id }),
  pickRootPath: () => invoke('pick_root_path'),
  pickEntryFile: () => invoke('pick_entry_file'),
  importPreviewImage: () => invoke('import_preview_image'),
  openPath: (targetPath: string) => invoke('open_path', { targetPath }),
  copyToClipboard: (value: string) => invoke('copy_to_clipboard', { value })
}
