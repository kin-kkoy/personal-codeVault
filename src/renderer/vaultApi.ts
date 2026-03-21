import { invoke } from '@tauri-apps/api/core'
import type {
  BulkPathRepairInput,
  BulkPathRepairResult,
  DuplicateInspection,
  EntryBundleInspection,
  EntryFilters,
  EntryOption,
  EntryRelationship,
  ImportCandidate,
  ImportSaveResult,
  InlineEntryPatch,
  PathHealth,
  PortableExportResult,
  PortableImportResult,
  QuickFilePreview,
  QuickPreviewInspection,
  RecentActivity,
  RelationshipInput,
  RelinkEntryPathsInput,
  TemplateDuplicationInput,
  VaultBackupInspection,
  VaultApi,
  VaultEntry,
  VaultEntryInput
} from '@shared/types'

export const vaultApi: VaultApi = {
  listEntries: (filters?: Partial<EntryFilters>) =>
    invoke<VaultEntry[]>('list_entries', { filters: filters ?? null }),
  getEntry: (id: string) => invoke<VaultEntry | null>('get_entry', { id }),
  createEntry: (input: VaultEntryInput) => invoke<VaultEntry>('create_entry', { input }),
  updateEntry: (id: string, input: VaultEntryInput) =>
    invoke<VaultEntry>('update_entry', { id, input }),
  patchEntry: (id: string, patch: InlineEntryPatch) =>
    invoke<VaultEntry>('patch_entry', { id, patch }),
  archiveEntry: (id: string) => invoke<void>('archive_entry', { id }),
  deleteEntry: (id: string) => invoke<void>('delete_entry', { id }),
  listTags: () => invoke<string[]>('list_tags'),
  listEntryOptions: () => invoke<EntryOption[]>('list_entry_options'),
  listRelationships: (entryId: string) =>
    invoke<EntryRelationship[]>('list_relationships', { entryId }),
  createRelationship: (input: RelationshipInput) => invoke<void>('create_relationship', { input }),
  deleteRelationship: (id: string) => invoke<void>('delete_relationship', { id }),
  duplicateTemplate: (input: TemplateDuplicationInput) =>
    invoke<VaultEntry>('duplicate_template', { input }),
  scanImportCandidate: (sourcePath: string) =>
    invoke<ImportCandidate>('scan_import_candidate', { sourcePath }),
  scanBatchImportCandidates: (parentPath: string) =>
    invoke<ImportCandidate[]>('scan_batch_import_candidates', { parentPath }),
  saveImportCandidates: (candidates: ImportCandidate[]) =>
    invoke<ImportSaveResult[]>('save_import_candidates', { candidates }),
  refreshMetadata: (rootPath: string, entryFilePath: string) =>
    invoke<ImportCandidate>('refresh_metadata', { rootPath, entryFilePath }),
  inspectQuickPreview: (rootPath: string, preferredPath: string) =>
    invoke<QuickPreviewInspection>('inspect_quick_preview', { rootPath, preferredPath }),
  readQuickPreview: (targetPath: string, rootPath: string) =>
    invoke<QuickFilePreview>('read_quick_preview', { targetPath, rootPath }),
  listRecentActivity: (limit = 6) => invoke<RecentActivity>('list_recent_activity', { limit }),
  markEntryViewed: (id: string) => invoke<void>('mark_entry_viewed', { id }),
  inspectDuplicates: (entryId: string) =>
    invoke<DuplicateInspection>('inspect_duplicates', { entryId }),
  inspectPathHealth: (entryId: string) => invoke<PathHealth>('inspect_path_health', { entryId }),
  relinkEntryPaths: (input: RelinkEntryPathsInput) =>
    invoke<VaultEntry>('relink_entry_paths', { input }),
  bulkRepairPaths: (input: BulkPathRepairInput) =>
    invoke<BulkPathRepairResult>('bulk_repair_paths', { input }),
  attachPreviewImageToEntry: (entryId: string, sourcePath: string) =>
    invoke<VaultEntry>('attach_preview_image_to_entry', { entryId, sourcePath }),
  removePreviewImage: (entryId: string, previewId: string) =>
    invoke<VaultEntry>('remove_preview_image', { entryId, previewId }),
  movePreviewImage: (entryId: string, previewId: string, direction: 'left' | 'right') =>
    invoke<VaultEntry>('move_preview_image', { entryId, previewId, direction }),
  exportEntryMetadata: (entryId: string) =>
    invoke<PortableExportResult>('export_entry_metadata', { entryId }),
  exportEntryBundle: (entryId: string) =>
    invoke<PortableExportResult>('export_entry_bundle', { entryId }),
  inspectEntryBundle: () => invoke<EntryBundleInspection | null>('inspect_entry_bundle'),
  importEntryBundle: (packagePath: string) =>
    invoke<PortableImportResult>('import_entry_bundle', { packagePath }),
  exportVaultBackup: () => invoke<PortableExportResult>('export_vault_backup'),
  inspectVaultBackup: () => invoke<VaultBackupInspection | null>('inspect_vault_backup'),
  restoreVaultBackup: (packagePath: string) =>
    invoke<PortableImportResult>('restore_vault_backup', { packagePath }),
  pickRootPath: () => invoke('pick_root_path'),
  pickEntryFile: () => invoke('pick_entry_file'),
  importPreviewImage: () => invoke('import_preview_image'),
  openPath: (targetPath: string) => invoke('open_path', { targetPath }),
  copyToClipboard: (value: string) => invoke('copy_to_clipboard', { value }),
  pasteClipboardImage: (entryId: string) =>
    invoke<VaultEntry>('paste_clipboard_image', { entryId }),
  runEntryCommand: (rootPath: string, command: string) =>
    invoke('run_entry_command', { rootPath, command })
}
