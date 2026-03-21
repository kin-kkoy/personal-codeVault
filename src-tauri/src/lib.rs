use std::{
    collections::{BTreeSet, HashMap, HashSet},
    ffi::OsStr,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use arboard::Clipboard;
use image::{ImageBuffer, Rgba};
use rfd::FileDialog;
use rusqlite::{params, params_from_iter, Connection};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;

const ENTRY_COLUMNS: &str = "
    id,
    title,
    description,
    type,
    tags,
    stack,
    root_path,
    entry_file_path,
    preview_image_path,
    is_favorite,
    is_pinned,
    is_template,
    notes,
    good_for,
    setup_notes,
    dependency_notes,
    run_command,
    status,
    last_viewed_at,
    created_at,
    updated_at
";

const MAX_SCAN_DEPTH: usize = 3;
const MAX_SCANNED_FILES: usize = 240;
const MAX_IMAGE_CANDIDATES: usize = 12;
const MAX_PREVIEWABLE_FILES: usize = 20;
const MAX_QUICK_PREVIEW_BYTES: usize = 64 * 1024;
const MAX_QUICK_PREVIEW_LINES: usize = 250;
const PORTABLE_FORMAT_VERSION: &str = "1";
const PORTABLE_ENTRY_KIND: &str = "entry-bundle";
const PORTABLE_BACKUP_KIND: &str = "vault-backup";
const PORTABLE_MANIFEST_FILE: &str = "manifest.json";
const PORTABLE_ENTRY_FILES_DIR: &str = "files";
const PORTABLE_ENTRY_PREVIEWS_DIR: &str = "previews";
const PORTABLE_BACKUP_DB_FILE: &str = "vault.sqlite";
const PORTABLE_BACKUP_SOURCES_DIR: &str = "sources";
const PORTABLE_BACKUP_PREVIEWS_DIR: &str = "previews";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewImage {
    id: String,
    path: String,
    order: i64,
    created_at: String,
    is_missing: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultEntry {
    id: String,
    title: String,
    description: String,
    r#type: String,
    tags: Vec<String>,
    stack: String,
    root_path: String,
    entry_file_path: String,
    preview_image_path: String,
    preview_images: Vec<PreviewImage>,
    is_favorite: bool,
    is_pinned: bool,
    is_template: bool,
    notes: String,
    good_for: String,
    setup_notes: String,
    dependency_notes: String,
    run_command: String,
    status: String,
    has_broken_paths: bool,
    last_viewed_at: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultEntryInput {
    title: String,
    description: String,
    r#type: String,
    tags: Vec<String>,
    stack: String,
    root_path: String,
    entry_file_path: String,
    preview_image_path: String,
    preview_images: Vec<PreviewImage>,
    is_favorite: bool,
    is_pinned: bool,
    is_template: bool,
    notes: String,
    good_for: String,
    setup_notes: String,
    dependency_notes: String,
    run_command: String,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct InlineEntryPatch {
    title: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    stack: Option<String>,
    status: Option<String>,
    notes: Option<String>,
    good_for: Option<String>,
    setup_notes: Option<String>,
    dependency_notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EntryFilters {
    query: Option<String>,
    r#type: Option<String>,
    status: Option<String>,
    include_archived: Option<bool>,
    only_favorites: Option<bool>,
    only_pinned: Option<bool>,
    only_templates: Option<bool>,
    sort_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EntryOption {
    id: String,
    title: String,
    r#type: String,
    status: String,
    is_template: bool,
    relationship_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EntryRelationshipTarget {
    id: String,
    title: String,
    r#type: String,
    status: String,
    is_template: bool,
    is_favorite: bool,
    is_pinned: bool,
    preview_image_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EntryRelationship {
    id: String,
    source_entry_id: String,
    target_entry_id: String,
    relationship_type: String,
    created_at: String,
    target: EntryRelationshipTarget,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelationshipInput {
    source_entry_id: String,
    target_entry_id: String,
    relationship_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateDuplicationInput {
    template_entry_id: String,
    destination_parent_path: String,
    new_project_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewImageCandidate {
    path: String,
    label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewableFile {
    path: String,
    relative_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickPreviewInspection {
    files: Vec<PreviewableFile>,
    default_preview_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickFilePreview {
    path: String,
    relative_path: String,
    content: String,
    truncated: bool,
    message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ImportCandidate {
    temp_id: String,
    source_path: String,
    source_kind: String,
    title: String,
    description: String,
    r#type: String,
    tags: Vec<String>,
    stack: String,
    root_path: String,
    entry_file_path: String,
    preview_image_path: String,
    preview_images: Vec<PreviewImage>,
    preview_image_candidates: Vec<PreviewImageCandidate>,
    previewable_files: Vec<PreviewableFile>,
    default_preview_path: String,
    is_favorite: bool,
    is_pinned: bool,
    is_template: bool,
    notes: String,
    good_for: String,
    setup_notes: String,
    dependency_notes: String,
    run_command: String,
    status: String,
    duplicate_root_path: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportSaveResult {
    temp_id: String,
    success: bool,
    message: String,
    entry: Option<VaultEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PathHealth {
    root_path_exists: bool,
    entry_file_exists: bool,
    missing_preview_images: Vec<PreviewImage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DuplicateMatch {
    r#type: String,
    entry_id: String,
    title: String,
    detail: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct DuplicateInspection {
    matches: Vec<DuplicateMatch>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecentActivity {
    viewed: Vec<VaultEntry>,
    created: Vec<VaultEntry>,
    updated: Vec<VaultEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewReplacement {
    preview_id: String,
    new_source_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RelinkEntryPathsInput {
    entry_id: String,
    new_root_path: Option<String>,
    new_entry_file_path: Option<String>,
    preview_replacements: Option<Vec<PreviewReplacement>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BulkPathRepairInput {
    old_prefix: String,
    new_prefix: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BulkPathRepairResult {
    updated_entries: usize,
    updated_previews: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortableExportResult {
    destination_path: String,
    warnings: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortableImportResult {
    success_count: usize,
    failure_count: usize,
    imported_entry_ids: Vec<String>,
    warnings: Vec<String>,
    message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortablePreviewAsset {
    relative_path: String,
    original_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortableRelationshipSummary {
    relationship_type: String,
    target_title: String,
    target_type: String,
    target_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortableEntryRecord {
    title: String,
    description: String,
    r#type: String,
    tags: Vec<String>,
    stack: String,
    is_favorite: bool,
    is_pinned: bool,
    is_template: bool,
    notes: String,
    good_for: String,
    setup_notes: String,
    dependency_notes: String,
    run_command: String,
    status: String,
    root_folder_name: String,
    source_relative_dir: String,
    source_included: bool,
    source_file_count: usize,
    entry_file_relative_path: String,
    previews: Vec<PortablePreviewAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EntryBundleManifest {
    kind: String,
    format_version: String,
    exported_at: String,
    entry: PortableEntryRecord,
    relationships: Vec<PortableRelationshipSummary>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultBackupEntry {
    old_id: String,
    entry: PortableEntryRecord,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultBackupRelationship {
    source_old_id: String,
    target_old_id: String,
    relationship_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultBackupManifest {
    kind: String,
    format_version: String,
    exported_at: String,
    entries: Vec<VaultBackupEntry>,
    relationships: Vec<VaultBackupRelationship>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EntryBundleInspection {
    package_path: String,
    display_name: String,
    title: String,
    r#type: String,
    preview_count: usize,
    includes_source_files: bool,
    source_file_count: usize,
    relationship_count: usize,
    warnings: Vec<String>,
    duplicate_matches: Vec<DuplicateMatch>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultBackupInspection {
    package_path: String,
    display_name: String,
    entry_count: usize,
    relationship_count: usize,
    preview_count: usize,
    source_bundle_count: usize,
    warnings: Vec<String>,
    duplicate_matches: Vec<DuplicateMatch>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileSelection {
    canceled: bool,
    path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenPathResult {
    success: bool,
    message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RunCommandResult {
    success: bool,
    message: Option<String>,
}

#[derive(Default)]
struct ProjectSnapshot {
    files: Vec<PathBuf>,
    readme_path: Option<PathBuf>,
    image_candidates: Vec<PathBuf>,
    previewable_files: Vec<PathBuf>,
    package_json: Option<PathBuf>,
    cargo_toml: Option<PathBuf>,
    pyproject_toml: Option<PathBuf>,
    requirements_txt: Option<PathBuf>,
    go_mod: Option<PathBuf>,
    binary_candidates: Vec<PathBuf>,
}

#[derive(Clone)]
struct EntryRow {
    id: String,
    title: String,
    description: String,
    r#type: String,
    tags: String,
    stack: String,
    root_path: String,
    entry_file_path: String,
    preview_image_path: String,
    is_favorite: bool,
    is_pinned: bool,
    is_template: bool,
    notes: String,
    good_for: String,
    setup_notes: String,
    dependency_notes: String,
    run_command: String,
    status: String,
    last_viewed_at: String,
    created_at: String,
    updated_at: String,
}

fn app_data_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn previews_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    let dir = app_data_dir(app)?.join("previews");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn db_path(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app_data_dir(app)?.join("code-vault.sqlite"))
}

fn open_db(app: &AppHandle) -> CommandResult<Connection> {
    let connection = Connection::open(db_path(app)?).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS entries (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              type TEXT NOT NULL,
              tags TEXT NOT NULL DEFAULT '',
              stack TEXT NOT NULL DEFAULT '',
              root_path TEXT NOT NULL,
              entry_file_path TEXT NOT NULL DEFAULT '',
              preview_image_path TEXT NOT NULL DEFAULT '',
              is_favorite INTEGER NOT NULL DEFAULT 0,
              is_pinned INTEGER NOT NULL DEFAULT 0,
              is_template INTEGER NOT NULL DEFAULT 0,
              notes TEXT NOT NULL DEFAULT '',
              good_for TEXT NOT NULL DEFAULT '',
              setup_notes TEXT NOT NULL DEFAULT '',
              dependency_notes TEXT NOT NULL DEFAULT '',
              run_command TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              last_viewed_at TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entry_relationships (
              id TEXT PRIMARY KEY,
              source_entry_id TEXT NOT NULL,
              target_entry_id TEXT NOT NULL,
              relationship_type TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(source_entry_id, target_entry_id, relationship_type),
              FOREIGN KEY(source_entry_id) REFERENCES entries(id) ON DELETE CASCADE,
              FOREIGN KEY(target_entry_id) REFERENCES entries(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS preview_assets (
              id TEXT PRIMARY KEY,
              entry_id TEXT NOT NULL,
              path TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    migrate_entry_columns(&connection)?;
    seed_preview_assets(&connection)?;
    Ok(connection)
}

fn migrate_entry_columns(connection: &Connection) -> CommandResult<()> {
    let existing_columns = get_existing_entry_columns(connection)?;

    for (column_name, definition) in [
        ("is_favorite", "INTEGER NOT NULL DEFAULT 0"),
        ("is_pinned", "INTEGER NOT NULL DEFAULT 0"),
        ("is_template", "INTEGER NOT NULL DEFAULT 0"),
        ("good_for", "TEXT NOT NULL DEFAULT ''"),
        ("setup_notes", "TEXT NOT NULL DEFAULT ''"),
        ("dependency_notes", "TEXT NOT NULL DEFAULT ''"),
        ("run_command", "TEXT NOT NULL DEFAULT ''"),
        ("last_viewed_at", "TEXT NOT NULL DEFAULT ''"),
    ] {
        if !existing_columns.contains(column_name) {
            connection
                .execute(
                    &format!("ALTER TABLE entries ADD COLUMN {column_name} {definition}"),
                    [],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn get_existing_entry_columns(connection: &Connection) -> CommandResult<HashSet<String>> {
    let mut statement = connection
        .prepare("PRAGMA table_info(entries)")
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| row.get::<_, String>("name"))
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())
}

fn seed_preview_assets(connection: &Connection) -> CommandResult<()> {
    let mut statement = connection
        .prepare(
            "
            SELECT e.id, e.preview_image_path, e.updated_at
            FROM entries e
            WHERE e.preview_image_path != ''
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (entry_id, path, updated_at) = row.map_err(|error| error.to_string())?;
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM preview_assets WHERE entry_id = ?",
                params![entry_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;

        if count == 0 {
            connection
                .execute(
                    "
                    INSERT INTO preview_assets (id, entry_id, path, sort_order, created_at)
                    VALUES (?, ?, ?, 0, ?)
                    ",
                    params![Uuid::new_v4().to_string(), entry_id, path, updated_at],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let datetime = time::OffsetDateTime::from_unix_timestamp(now as i64)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    datetime
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn normalize_tags(tags: &[String]) -> String {
    tags.iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

fn parse_tags(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn bool_from_sql(value: i64) -> bool {
    value != 0
}

fn primary_preview_path(images: &[PreviewImage]) -> String {
    images.first().map(|image| image.path.clone()).unwrap_or_default()
}

fn make_preview_image(path: String, order: i64) -> PreviewImage {
    PreviewImage {
        id: Uuid::new_v4().to_string(),
        path: path.clone(),
        order,
        created_at: now_iso(),
        is_missing: !path.is_empty() && !Path::new(&path).exists(),
    }
}

fn normalized_preview_images(preview_images: &[PreviewImage], preview_image_path: &str) -> Vec<PreviewImage> {
    let mut next = if !preview_images.is_empty() {
        preview_images.to_vec()
    } else if !preview_image_path.trim().is_empty() {
        vec![make_preview_image(preview_image_path.trim().to_string(), 0)]
    } else {
        Vec::new()
    };

    for (index, image) in next.iter_mut().enumerate() {
        if image.id.trim().is_empty() {
            image.id = Uuid::new_v4().to_string();
        }
        image.order = index as i64;
        if image.created_at.trim().is_empty() {
            image.created_at = now_iso();
        }
        image.is_missing = !image.path.trim().is_empty() && !Path::new(image.path.trim()).exists();
    }

    next
}

fn map_entry_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntryRow> {
    Ok(EntryRow {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        r#type: row.get("type")?,
        tags: row.get("tags")?,
        stack: row.get("stack")?,
        root_path: row.get("root_path")?,
        entry_file_path: row.get("entry_file_path")?,
        preview_image_path: row.get("preview_image_path")?,
        is_favorite: bool_from_sql(row.get("is_favorite")?),
        is_pinned: bool_from_sql(row.get("is_pinned")?),
        is_template: bool_from_sql(row.get("is_template")?),
        notes: row.get("notes")?,
        good_for: row.get("good_for")?,
        setup_notes: row.get("setup_notes")?,
        dependency_notes: row.get("dependency_notes")?,
        run_command: row.get("run_command")?,
        status: row.get("status")?,
        last_viewed_at: row.get("last_viewed_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn load_preview_images(connection: &Connection, entry_id: &str) -> CommandResult<Vec<PreviewImage>> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, path, sort_order, created_at
            FROM preview_assets
            WHERE entry_id = ?
            ORDER BY sort_order ASC, datetime(created_at) ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![entry_id], |row| {
            let path: String = row.get("path")?;
            Ok(PreviewImage {
                id: row.get("id")?,
                path: path.clone(),
                order: row.get("sort_order")?,
                created_at: row.get("created_at")?,
                is_missing: !path.trim().is_empty() && !Path::new(path.trim()).exists(),
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn compute_path_health_from_values(
    root_path: &str,
    entry_file_path: &str,
    preview_images: &[PreviewImage],
) -> PathHealth {
    let root_path_exists = !root_path.trim().is_empty() && Path::new(root_path.trim()).is_dir();
    let entry_file_exists = entry_file_path.trim().is_empty() || Path::new(entry_file_path.trim()).exists();
    let missing_preview_images = preview_images
        .iter()
        .filter(|image| image.is_missing)
        .cloned()
        .collect::<Vec<_>>();

    PathHealth {
        root_path_exists,
        entry_file_exists,
        missing_preview_images,
    }
}

fn compute_has_broken_paths(health: &PathHealth) -> bool {
    !health.root_path_exists || !health.entry_file_exists || !health.missing_preview_images.is_empty()
}

fn hydrate_entry(connection: &Connection, row: EntryRow) -> CommandResult<VaultEntry> {
    let preview_images = load_preview_images(connection, &row.id)?;
    let path_health =
        compute_path_health_from_values(&row.root_path, &row.entry_file_path, &preview_images);

    Ok(VaultEntry {
        id: row.id,
        title: row.title,
        description: row.description,
        r#type: row.r#type,
        tags: parse_tags(&row.tags),
        stack: row.stack,
        root_path: row.root_path,
        entry_file_path: row.entry_file_path,
        preview_image_path: if preview_images.is_empty() {
            row.preview_image_path
        } else {
            primary_preview_path(&preview_images)
        },
        preview_images,
        is_favorite: row.is_favorite,
        is_pinned: row.is_pinned,
        is_template: row.is_template,
        notes: row.notes,
        good_for: row.good_for,
        setup_notes: row.setup_notes,
        dependency_notes: row.dependency_notes,
        run_command: row.run_command,
        status: row.status,
        has_broken_paths: compute_has_broken_paths(&path_health),
        last_viewed_at: row.last_viewed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn get_entry_by_id(connection: &Connection, id: &str) -> CommandResult<Option<VaultEntry>> {
    let mut statement = connection
        .prepare(&format!(
            "
            SELECT {ENTRY_COLUMNS}
            FROM entries
            WHERE id = ?
            "
        ))
        .map_err(|error| error.to_string())?;

    let mut rows = statement
        .query(params![id])
        .map_err(|error| error.to_string())?;

    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => {
            let entry_row = map_entry_row(row).map_err(|error| error.to_string())?;
            Ok(Some(hydrate_entry(connection, entry_row)?))
        }
        None => Ok(None),
    }
}

fn get_all_entry_rows(connection: &Connection) -> CommandResult<Vec<EntryRow>> {
    let mut statement = connection
        .prepare(&format!("SELECT {ENTRY_COLUMNS} FROM entries"))
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], map_entry_row)
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn sync_preview_assets_for_entry(
    connection: &Connection,
    entry_id: &str,
    preview_images: &[PreviewImage],
) -> CommandResult<()> {
    let normalized = normalized_preview_images(preview_images, "");
    let keep_ids = normalized
        .iter()
        .map(|image| image.id.clone())
        .collect::<HashSet<_>>();

    let mut existing_statement = connection
        .prepare("SELECT id FROM preview_assets WHERE entry_id = ?")
        .map_err(|error| error.to_string())?;
    let existing_rows = existing_statement
        .query_map(params![entry_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let existing_ids = existing_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    for image in &normalized {
        let exists = existing_ids.iter().any(|id| id == &image.id);
        if exists {
            connection
                .execute(
                    "
                    UPDATE preview_assets
                    SET path = ?, sort_order = ?
                    WHERE id = ? AND entry_id = ?
                    ",
                    params![image.path.trim(), image.order, image.id, entry_id],
                )
                .map_err(|error| error.to_string())?;
        } else {
            connection
                .execute(
                    "
                    INSERT INTO preview_assets (id, entry_id, path, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    ",
                    params![
                        image.id,
                        entry_id,
                        image.path.trim(),
                        image.order,
                        image.created_at,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    for existing_id in existing_ids {
        if !keep_ids.contains(&existing_id) {
            connection
                .execute("DELETE FROM preview_assets WHERE id = ?", params![existing_id])
                .map_err(|error| error.to_string())?;
        }
    }

    connection
        .execute(
            "UPDATE entries SET preview_image_path = ? WHERE id = ?",
            params![primary_preview_path(&normalized), entry_id],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn insert_entry(connection: &Connection, input: &VaultEntryInput) -> CommandResult<VaultEntry> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let preview_images = normalized_preview_images(&input.preview_images, &input.preview_image_path);

    connection
        .execute(
            "
            INSERT INTO entries (
              id,
              title,
              description,
              type,
              tags,
              stack,
              root_path,
              entry_file_path,
              preview_image_path,
              is_favorite,
              is_pinned,
              is_template,
              notes,
              good_for,
              setup_notes,
              dependency_notes,
              run_command,
              status,
              last_viewed_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ",
            params![
                id,
                input.title.trim(),
                input.description.trim(),
                input.r#type,
                normalize_tags(&input.tags),
                input.stack.trim(),
                input.root_path.trim(),
                input.entry_file_path.trim(),
                primary_preview_path(&preview_images),
                input.is_favorite as i64,
                input.is_pinned as i64,
                input.is_template as i64,
                input.notes.trim(),
                input.good_for.trim(),
                input.setup_notes.trim(),
                input.dependency_notes.trim(),
                input.run_command.trim(),
                input.status,
                "",
                now,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;

    sync_preview_assets_for_entry(connection, &id, &preview_images)?;
    get_entry_by_id(connection, &id)?.ok_or_else(|| "Failed to create entry.".to_string())
}

fn update_entry_record(
    connection: &Connection,
    id: &str,
    input: &VaultEntryInput,
) -> CommandResult<VaultEntry> {
    let now = now_iso();
    let preview_images = normalized_preview_images(&input.preview_images, &input.preview_image_path);

    connection
        .execute(
            "
            UPDATE entries
            SET
              title = ?,
              description = ?,
              type = ?,
              tags = ?,
              stack = ?,
              root_path = ?,
              entry_file_path = ?,
              preview_image_path = ?,
              is_favorite = ?,
              is_pinned = ?,
              is_template = ?,
              notes = ?,
              good_for = ?,
              setup_notes = ?,
              dependency_notes = ?,
              run_command = ?,
              status = ?,
              updated_at = ?
            WHERE id = ?
            ",
            params![
                input.title.trim(),
                input.description.trim(),
                input.r#type,
                normalize_tags(&input.tags),
                input.stack.trim(),
                input.root_path.trim(),
                input.entry_file_path.trim(),
                primary_preview_path(&preview_images),
                input.is_favorite as i64,
                input.is_pinned as i64,
                input.is_template as i64,
                input.notes.trim(),
                input.good_for.trim(),
                input.setup_notes.trim(),
                input.dependency_notes.trim(),
                input.run_command.trim(),
                input.status,
                now,
                id,
            ],
        )
        .map_err(|error| error.to_string())?;

    sync_preview_assets_for_entry(connection, id, &preview_images)?;
    get_entry_by_id(connection, id)?.ok_or_else(|| "Failed to update entry.".to_string())
}

fn normalize_compare_path(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .trim()
        .to_string()
}

fn entry_exists_with_root_path(connection: &Connection, root_path: &Path) -> CommandResult<bool> {
    let normalized_target = normalize_compare_path(root_path);
    let rows = get_all_entry_rows(connection)?;
    Ok(rows
        .iter()
        .any(|entry| normalize_compare_path(Path::new(entry.root_path.trim())) == normalized_target))
}

fn copy_preview_image_into_app(app: &AppHandle, source: &str) -> CommandResult<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let source_path = PathBuf::from(trimmed);
    if !source_path.is_file() {
        return Err("Selected preview image does not exist on disk.".to_string());
    }

    let preview_root = previews_dir(app)?;
    if source_path.starts_with(&preview_root) {
        return Ok(source_path.to_string_lossy().to_string());
    }

    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("preview");
    let copied_name = format!("{}-{}.{}", timestamp_millis(), stem, extension);
    let destination = preview_root.join(copied_name);

    fs::copy(&source_path, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

fn looks_like_readme(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|stem| stem.eq_ignore_ascii_case("readme"))
}

fn looks_like_preview_image(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    let is_image = matches!(
        extension.as_deref(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp")
    );

    if !is_image {
        return false;
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let exclusions = [
        "favicon", "icon", "logo", "badge", "avatar", "sprite", "banner",
        "apple-touch", "og-image", "opengraph", "android-chrome",
        "mstile", "browserconfig", "site.webmanifest",
    ];
    if exclusions.iter().any(|needle| file_name.contains(needle)) {
        return false;
    }

    let preview_hints = [
        "preview", "screenshot", "screen", "capture", "snap", "shot",
        "thumb", "cover", "demo", "snippet", "recording", "grab", "clip",
    ];
    if preview_hints.iter().any(|needle| file_name.contains(needle)) {
        return true;
    }

    // Accept images in the project root (not nested in subdirectories)
    let is_in_root = path.parent() == path.ancestors().nth(1);
    if is_in_root {
        return true;
    }

    false
}

fn is_previewable_text_file(path: &Path) -> bool {
    if looks_like_readme(path) {
        return true;
    }

    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some(
            "txt"
                | "md"
                | "json"
                | "toml"
                | "yaml"
                | "yml"
                | "ini"
                | "env"
                | "js"
                | "jsx"
                | "ts"
                | "tsx"
                | "css"
                | "scss"
                | "html"
                | "rs"
                | "py"
                | "go"
                | "java"
                | "kt"
                | "swift"
                | "sql"
                | "sh"
                | "bash"
                | "zsh"
                | "c"
                | "cpp"
                | "h"
                | "hpp"
                | "cs"
                | "php"
                | "rb"
                | "lua"
        )
    )
}

fn looks_like_binary_candidate(path: &Path, root: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let root_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("exe" | "appimage")
    ) {
        return true;
    }

    path.extension().is_none()
        && !is_previewable_text_file(path)
        && !file_name.is_empty()
        && (file_name == root_name
            || path
                .parent()
                .and_then(|parent| parent.file_name())
                .and_then(|value| value.to_str())
                .is_some_and(|parent| {
                    matches!(parent, "build" | "dist" | "release" | "debug" | "out")
                }))
}

fn relative_label(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn scan_directory(root: &Path) -> CommandResult<ProjectSnapshot> {
    let mut snapshot = ProjectSnapshot::default();
    visit_directory(root, root, 0, &mut snapshot)?;
    Ok(snapshot)
}

fn visit_directory(
    root: &Path,
    directory: &Path,
    depth: usize,
    snapshot: &mut ProjectSnapshot,
) -> CommandResult<()> {
    if depth > MAX_SCAN_DEPTH || snapshot.files.len() >= MAX_SCANNED_FILES {
        return Ok(());
    }

    let mut entries = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        if snapshot.files.len() >= MAX_SCANNED_FILES {
            break;
        }

        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if should_exclude_path(&name, &path) {
            continue;
        }

        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            visit_directory(root, &path, depth + 1, snapshot)?;
            continue;
        }

        if !metadata.is_file() {
            continue;
        }

        snapshot.files.push(path.clone());

        if snapshot.readme_path.is_none() && looks_like_readme(&path) {
            snapshot.readme_path = Some(path.clone());
        }

        if snapshot.image_candidates.len() < MAX_IMAGE_CANDIDATES && looks_like_preview_image(&path)
        {
            snapshot.image_candidates.push(path.clone());
        }

        if snapshot.previewable_files.len() < MAX_PREVIEWABLE_FILES
            && is_previewable_text_file(&path)
        {
            snapshot.previewable_files.push(path.clone());
        }

        if looks_like_binary_candidate(&path, root) {
            snapshot.binary_candidates.push(path.clone());
        }

        match path.file_name().and_then(|value| value.to_str()) {
            Some("package.json") if snapshot.package_json.is_none() => {
                snapshot.package_json = Some(path)
            }
            Some("Cargo.toml") if snapshot.cargo_toml.is_none() => snapshot.cargo_toml = Some(path),
            Some("pyproject.toml") if snapshot.pyproject_toml.is_none() => {
                snapshot.pyproject_toml = Some(path)
            }
            Some("requirements.txt") if snapshot.requirements_txt.is_none() => {
                snapshot.requirements_txt = Some(path)
            }
            Some("go.mod") if snapshot.go_mod.is_none() => snapshot.go_mod = Some(path),
            _ => {}
        }
    }

    Ok(())
}

fn read_text_file(path: &Path, byte_limit: usize) -> CommandResult<String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut buffer = Vec::new();
    file.take(byte_limit as u64)
        .read_to_end(&mut buffer)
        .map_err(|error| error.to_string())?;
    String::from_utf8(buffer)
        .map(|content| content.replace('\u{feff}', ""))
        .map_err(|_| "The file is not valid UTF-8 text.".to_string())
}

fn read_readme_description(path: &Path) -> String {
    let Ok(content) = read_text_file(path, 24 * 1024) else {
        return String::new();
    };

    let mut lines = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    if let Some(first) = lines.first() {
        if first.starts_with('#') {
            lines.remove(0);
        }
    }

    lines
        .into_iter()
        .find(|line| !line.starts_with('#'))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn package_json_string(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn detect_stack(snapshot: &ProjectSnapshot) -> String {
    let mut stack = BTreeSet::new();

    if snapshot.package_json.is_some() {
        stack.insert("JavaScript".to_string());
    }

    if snapshot
        .files
        .iter()
        .any(|path| matches!(path.extension().and_then(OsStr::to_str), Some("ts" | "tsx")))
    {
        stack.insert("TypeScript".to_string());
    }

    if let Some(package_json) = &snapshot.package_json {
        let package_text = package_json_string(package_json).to_ascii_lowercase();
        if package_text.contains("\"react\"") {
            stack.insert("React".to_string());
        }
        if package_text.contains("\"tauri\"") {
            stack.insert("Tauri".to_string());
        }
        if package_text.contains("sqlite") {
            stack.insert("SQLite".to_string());
        }
    }

    if snapshot.cargo_toml.is_some() {
        stack.insert("Rust".to_string());
    }

    if snapshot
        .cargo_toml
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .is_some_and(|content| content.to_ascii_lowercase().contains("tauri"))
    {
        stack.insert("Tauri".to_string());
    }

    if snapshot.pyproject_toml.is_some()
        || snapshot.requirements_txt.is_some()
        || snapshot
            .files
            .iter()
            .any(|path| matches!(path.extension().and_then(OsStr::to_str), Some("py")))
    {
        stack.insert("Python".to_string());
    }

    if snapshot.go_mod.is_some()
        || snapshot
            .files
            .iter()
            .any(|path| matches!(path.extension().and_then(OsStr::to_str), Some("go")))
    {
        stack.insert("Go".to_string());
    }

    if snapshot
        .files
        .iter()
        .any(|path| matches!(path.extension().and_then(OsStr::to_str), Some("sql")))
    {
        stack.insert("SQL".to_string());
    }

    stack.into_iter().collect::<Vec<_>>().join(", ")
}

fn detect_tags(snapshot: &ProjectSnapshot, entry_type: &str, stack: &str) -> Vec<String> {
    let mut tags = BTreeSet::new();

    for item in stack
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        tags.insert(item.to_ascii_lowercase());
    }

    tags.insert(entry_type.to_ascii_lowercase());

    if snapshot.readme_path.is_some() {
        tags.insert("readme".to_string());
    }

    if snapshot.binary_candidates.first().is_some() {
        tags.insert("executable".to_string());
    }

    if snapshot.image_candidates.first().is_some() {
        tags.insert("visual".to_string());
    }

    tags.into_iter().collect()
}

fn prettify_title(path: &Path) -> String {
    path.file_stem()
        .or_else(|| path.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("Imported item")
        .replace(['_', '-'], " ")
}

fn find_priority_match(
    snapshot: &ProjectSnapshot,
    root: &Path,
    candidates: &[&str],
) -> Option<PathBuf> {
    for candidate in candidates {
        if let Some(found) = snapshot.files.iter().find(|path| {
            relative_label(root, path)
                .to_ascii_lowercase()
                .eq(&candidate.to_ascii_lowercase())
        }) {
            return Some(found.clone());
        }
    }

    None
}

fn detect_entry_file(
    source_path: &Path,
    root: &Path,
    snapshot: &ProjectSnapshot,
    source_kind: &str,
) -> String {
    if source_kind == "file" {
        return source_path.to_string_lossy().to_string();
    }

    let priority_files = [
        "main.ts",
        "main.tsx",
        "main.js",
        "main.jsx",
        "main.py",
        "main.rs",
        "main.go",
        "index.ts",
        "index.tsx",
        "index.js",
        "index.jsx",
        "app.tsx",
        "app.jsx",
        "src/main.ts",
        "src/main.tsx",
        "src/main.js",
        "src/main.py",
        "src/main.rs",
        "src/app.tsx",
        "src/index.tsx",
    ];

    if let Some(found) = find_priority_match(snapshot, root, &priority_files) {
        return found.to_string_lossy().to_string();
    }

    if let Some(found) = snapshot.binary_candidates.first() {
        return found.to_string_lossy().to_string();
    }

    snapshot
        .previewable_files
        .first()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn detect_type(
    source_path: &Path,
    entry_file_path: &str,
    snapshot: &ProjectSnapshot,
    source_kind: &str,
) -> String {
    let mut signals = vec![prettify_title(source_path).to_ascii_lowercase()];
    signals.extend(
        source_path
            .components()
            .filter_map(|component| component.as_os_str().to_str())
            .map(|component| component.to_ascii_lowercase()),
    );

    if signals.iter().any(|signal| {
        signal.contains("template") || signal.contains("starter") || signal.contains("boilerplate")
    }) {
        return "template".to_string();
    }

    if signals.iter().any(|signal| {
        signal.contains("experiment")
            || signal.contains("playground")
            || signal.contains("sandbox")
            || signal.contains("lab")
    }) {
        return "experiment".to_string();
    }

    if signals.iter().any(|signal| {
        signal.contains("prompt") || signal.contains("chatgpt") || signal.contains("llm")
    }) {
        return "prompt-output".to_string();
    }

    let entry_ext = Path::new(entry_file_path)
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if source_kind == "file" && matches!(entry_ext.as_str(), "tsx" | "jsx" | "vue" | "svelte") {
        return "component".to_string();
    }

    if signals.iter().any(|signal| {
        signal.contains("util") || signal.contains("helper") || signal.contains("toolkit")
    }) {
        return "utility".to_string();
    }

    if snapshot.package_json.is_some()
        || snapshot.cargo_toml.is_some()
        || snapshot.pyproject_toml.is_some()
        || snapshot.requirements_txt.is_some()
        || snapshot.go_mod.is_some()
        || !snapshot.binary_candidates.is_empty()
    {
        return "mini-app".to_string();
    }

    "snippet".to_string()
}

fn detect_run_command(
    root: &Path,
    entry_file_path: &str,
    snapshot: &ProjectSnapshot,
    source_kind: &str,
) -> String {
    if let Some(package_json_path) = &snapshot.package_json {
        if let Ok(value) =
            serde_json::from_str::<serde_json::Value>(&package_json_string(package_json_path))
        {
            if value
                .get("scripts")
                .and_then(|scripts| scripts.get("dev"))
                .is_some()
            {
                return "npm run dev".to_string();
            }

            if value
                .get("scripts")
                .and_then(|scripts| scripts.get("start"))
                .is_some()
            {
                return "npm run start".to_string();
            }
        }
    }

    if snapshot.cargo_toml.is_some() {
        return "cargo run".to_string();
    }

    if snapshot.go_mod.is_some() {
        return "go run .".to_string();
    }

    let entry_path = Path::new(entry_file_path);
    let relative = entry_path
        .strip_prefix(root)
        .unwrap_or(entry_path)
        .to_string_lossy()
        .to_string();

    match entry_path.extension().and_then(OsStr::to_str) {
        Some("py") => return format!("python3 {relative}"),
        Some("sh") => return format!("sh {relative}"),
        Some("js") if source_kind == "file" => return format!("node {relative}"),
        Some("ts") if source_kind == "file" => return format!("tsx {relative}"),
        _ => {}
    }

    if !relative.is_empty()
        && entry_path.exists()
        && (entry_path.extension().and_then(OsStr::to_str).is_none()
            || matches!(
                entry_path.extension().and_then(OsStr::to_str),
                Some("exe" | "appimage")
            ))
    {
        return format!("./{relative}");
    }

    String::new()
}

fn default_preview_path(preferred_path: &str, files: &[PreviewableFile]) -> String {
    let trimmed = preferred_path.trim();
    if !trimmed.is_empty() && files.iter().any(|file| file.path == trimmed) {
        return trimmed.to_string();
    }

    files
        .first()
        .map(|file| file.path.clone())
        .unwrap_or_default()
}

fn previewable_file_list(root: &Path, snapshot: &ProjectSnapshot) -> Vec<PreviewableFile> {
    let mut files = snapshot
        .previewable_files
        .iter()
        .map(|path| PreviewableFile {
            path: path.to_string_lossy().to_string(),
            relative_path: relative_label(root, path),
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    files
}

fn image_candidate_list(root: &Path, snapshot: &ProjectSnapshot) -> Vec<PreviewImageCandidate> {
    snapshot
        .image_candidates
        .iter()
        .map(|path| PreviewImageCandidate {
            path: path.to_string_lossy().to_string(),
            label: relative_label(root, path),
        })
        .collect()
}

fn analyze_import_source(
    connection: &Connection,
    source_path: &Path,
    force_duplicate_check: bool,
) -> CommandResult<ImportCandidate> {
    if !source_path.exists() {
        return Err("The selected import source does not exist.".to_string());
    }

    let source_kind = if source_path.is_file() { "file" } else { "folder" };
    let root = if source_kind == "file" {
        source_path
            .parent()
            .ok_or_else(|| "A file import must have a parent folder.".to_string())?
            .to_path_buf()
    } else {
        source_path.to_path_buf()
    };

    if !root.is_dir() {
        return Err("The import root must be an existing folder.".to_string());
    }

    let snapshot = scan_directory(&root)?;
    let entry_file_path = detect_entry_file(source_path, &root, &snapshot, source_kind);
    let entry_type = detect_type(source_path, &entry_file_path, &snapshot, source_kind);
    let stack = detect_stack(&snapshot);
    let title = prettify_title(source_path);
    let description = snapshot
        .readme_path
        .as_ref()
        .map(|path| read_readme_description(path))
        .unwrap_or_default();
    let previewable_files = previewable_file_list(&root, &snapshot);
    let default_preview_path = default_preview_path(&entry_file_path, &previewable_files);
    let preview_image_candidates = image_candidate_list(&root, &snapshot);
    let preview_images = preview_image_candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| PreviewImage {
            id: Uuid::new_v4().to_string(),
            path: candidate.path.clone(),
            order: index as i64,
            created_at: now_iso(),
            is_missing: false,
        })
        .collect::<Vec<_>>();
    let preview_image_path = primary_preview_path(&preview_images);
    let tags = detect_tags(&snapshot, &entry_type, &stack);
    let run_command = detect_run_command(&root, &entry_file_path, &snapshot, source_kind);
    let duplicate_root_path = if force_duplicate_check {
        entry_exists_with_root_path(connection, &root)?
    } else {
        false
    };

    Ok(ImportCandidate {
        temp_id: Uuid::new_v4().to_string(),
        source_path: source_path.to_string_lossy().to_string(),
        source_kind: source_kind.to_string(),
        title,
        description,
        r#type: entry_type,
        tags,
        stack,
        root_path: root.to_string_lossy().to_string(),
        entry_file_path,
        preview_image_path,
        preview_images,
        preview_image_candidates,
        previewable_files,
        default_preview_path,
        is_favorite: false,
        is_pinned: false,
        is_template: false,
        notes: String::new(),
        good_for: String::new(),
        setup_notes: String::new(),
        dependency_notes: String::new(),
        run_command,
        status: "draft".to_string(),
        duplicate_root_path,
    })
}

fn preview_message(
    path: &Path,
    root_path: &str,
    content: String,
    truncated: bool,
) -> QuickFilePreview {
    let root = Path::new(root_path);
    QuickFilePreview {
        path: path.to_string_lossy().to_string(),
        relative_path: relative_label(root, path),
        content,
        truncated,
        message: None,
    }
}

fn failure_preview(path: &Path, root_path: &str, message: &str) -> QuickFilePreview {
    let root = Path::new(root_path);
    QuickFilePreview {
        path: path.to_string_lossy().to_string(),
        relative_path: relative_label(root, path),
        content: String::new(),
        truncated: false,
        message: Some(message.to_string()),
    }
}

fn replace_path_prefix(path_value: &str, old_prefix: &str, new_prefix: &str) -> Option<String> {
    let trimmed_path = path_value.trim();
    let trimmed_old = old_prefix.trim();
    let trimmed_new = new_prefix.trim();
    if trimmed_path.is_empty() || trimmed_old.is_empty() || trimmed_new.is_empty() {
        return None;
    }

    let path = Path::new(trimmed_path);
    let old = Path::new(trimmed_old);
    path.strip_prefix(old)
        .ok()
        .map(|relative| Path::new(trimmed_new).join(relative).to_string_lossy().to_string())
}

fn load_recent_entries(
    connection: &Connection,
    condition: &str,
    order_by: &str,
    limit: usize,
) -> CommandResult<Vec<VaultEntry>> {
    let sql = format!(
        "
        SELECT {ENTRY_COLUMNS}
        FROM entries
        WHERE status != 'archived' {condition}
        ORDER BY {order_by}
        LIMIT ?
        "
    );

    let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![limit as i64], map_entry_row)
        .map_err(|error| error.to_string())?;

    let entry_rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    entry_rows
        .into_iter()
        .map(|row| hydrate_entry(connection, row))
        .collect()
}

#[tauri::command]
fn list_entries(app: AppHandle, filters: Option<EntryFilters>) -> CommandResult<Vec<VaultEntry>> {
    let connection = open_db(&app)?;
    let filters = filters.unwrap_or_default();
    let query = filters.query.unwrap_or_default().trim().to_lowercase();
    let entry_type = filters.r#type.unwrap_or_else(|| "all".to_string());
    let status = filters.status.unwrap_or_else(|| "all".to_string());
    let include_archived = filters.include_archived.unwrap_or(false);
    let only_favorites = filters.only_favorites.unwrap_or(false);
    let only_pinned = filters.only_pinned.unwrap_or(false);
    let only_templates = filters.only_templates.unwrap_or(false);
    let sort_by = filters.sort_by.unwrap_or_else(|| "updated".to_string());

    let mut sql = format!("SELECT {ENTRY_COLUMNS} FROM entries");
    let mut conditions: Vec<&str> = Vec::new();
    let mut params_vec: Vec<String> = Vec::new();

    if !include_archived {
        conditions.push("status != 'archived'");
    }

    if entry_type != "all" {
        conditions.push("type = ?");
        params_vec.push(entry_type);
    }

    if status != "all" {
        conditions.push("status = ?");
        params_vec.push(status);
    }

    if only_favorites {
        conditions.push("is_favorite = 1");
    }

    if only_pinned {
        conditions.push("is_pinned = 1");
    }

    if only_templates {
        conditions.push("is_template = 1");
    }

    if !query.is_empty() {
        conditions.push("(LOWER(title) LIKE ? OR LOWER(tags) LIKE ?)");
        let like_query = format!("%{query}%");
        params_vec.push(like_query.clone());
        params_vec.push(like_query);
    }

    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }

    let order_by = match sort_by.as_str() {
        "created" => "datetime(created_at) DESC, datetime(updated_at) DESC, LOWER(title) ASC",
        "title" => "LOWER(title) ASC, datetime(updated_at) DESC",
        "viewed" => "CASE WHEN last_viewed_at = '' THEN 1 ELSE 0 END ASC, datetime(last_viewed_at) DESC, datetime(updated_at) DESC, LOWER(title) ASC",
        _ => "datetime(updated_at) DESC, datetime(created_at) DESC, LOWER(title) ASC",
    };
    sql.push_str(" ORDER BY ");
    sql.push_str(order_by);

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(params_vec.iter()), map_entry_row)
        .map_err(|error| error.to_string())?;

    let entry_rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    entry_rows
        .into_iter()
        .map(|row| hydrate_entry(&connection, row))
        .collect()
}

#[tauri::command]
fn get_entry(app: AppHandle, id: String) -> CommandResult<Option<VaultEntry>> {
    let connection = open_db(&app)?;
    get_entry_by_id(&connection, &id)
}

#[tauri::command]
fn create_entry(app: AppHandle, input: VaultEntryInput) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    insert_entry(&connection, &input)
}

#[tauri::command]
fn update_entry(app: AppHandle, id: String, input: VaultEntryInput) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    update_entry_record(&connection, &id, &input)
}

#[tauri::command]
fn patch_entry(app: AppHandle, id: String, patch: InlineEntryPatch) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let current = get_entry_by_id(&connection, &id)?
        .ok_or_else(|| "Entry not found.".to_string())?;

    let input = VaultEntryInput {
        title: patch.title.unwrap_or(current.title),
        description: patch.description.unwrap_or(current.description),
        r#type: current.r#type,
        tags: patch.tags.unwrap_or(current.tags),
        stack: patch.stack.unwrap_or(current.stack),
        root_path: current.root_path,
        entry_file_path: current.entry_file_path,
        preview_image_path: current.preview_image_path,
        preview_images: current.preview_images,
        is_favorite: current.is_favorite,
        is_pinned: current.is_pinned,
        is_template: current.is_template,
        notes: patch.notes.unwrap_or(current.notes),
        good_for: patch.good_for.unwrap_or(current.good_for),
        setup_notes: patch.setup_notes.unwrap_or(current.setup_notes),
        dependency_notes: patch.dependency_notes.unwrap_or(current.dependency_notes),
        run_command: current.run_command,
        status: patch.status.unwrap_or(current.status),
    };

    update_entry_record(&connection, &id, &input)
}

#[tauri::command]
fn archive_entry(app: AppHandle, id: String) -> CommandResult<()> {
    let connection = open_db(&app)?;
    connection
        .execute(
            "UPDATE entries SET status = 'archived', updated_at = ? WHERE id = ?",
            params![now_iso(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_entry(app: AppHandle, id: String) -> CommandResult<()> {
    let connection = open_db(&app)?;
    connection
        .execute("DELETE FROM entries WHERE id = ?", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_tags(app: AppHandle) -> CommandResult<Vec<String>> {
    let connection = open_db(&app)?;
    let mut statement = connection
        .prepare("SELECT tags FROM entries WHERE tags != ''")
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| row.get::<_, String>("tags"))
        .map_err(|error| error.to_string())?;

    let mut tags: HashSet<String> = HashSet::new();
    for row in rows {
        let raw = row.map_err(|error| error.to_string())?;
        for tag in parse_tags(&raw) {
            tags.insert(tag);
        }
    }

    let mut list = tags.into_iter().collect::<Vec<_>>();
    list.sort_by_key(|tag| tag.to_lowercase());
    Ok(list)
}

#[tauri::command]
fn list_entry_options(app: AppHandle) -> CommandResult<Vec<EntryOption>> {
    let connection = open_db(&app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, type, status, is_template,
              (SELECT COUNT(*) FROM entry_relationships WHERE source_entry_id = e.id OR target_entry_id = e.id) AS relationship_count
            FROM entries e
            ORDER BY is_pinned DESC, is_favorite DESC, LOWER(title) ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(EntryOption {
                id: row.get("id")?,
                title: row.get("title")?,
                r#type: row.get("type")?,
                status: row.get("status")?,
                is_template: bool_from_sql(row.get("is_template")?),
                relationship_count: row.get("relationship_count")?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_relationships(app: AppHandle, entry_id: String) -> CommandResult<Vec<EntryRelationship>> {
    let connection = open_db(&app)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
              r.id,
              r.source_entry_id,
              r.target_entry_id,
              r.relationship_type,
              r.created_at,
              e.title,
              e.type,
              e.status,
              e.is_template,
              e.is_favorite,
              e.is_pinned,
              e.preview_image_path
            FROM entry_relationships r
            JOIN entries e ON e.id = r.target_entry_id
            WHERE r.source_entry_id = ?
            ORDER BY datetime(r.created_at) DESC, LOWER(e.title) ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![entry_id], |row| {
            Ok(EntryRelationship {
                id: row.get("id")?,
                source_entry_id: row.get("source_entry_id")?,
                target_entry_id: row.get("target_entry_id")?,
                relationship_type: row.get("relationship_type")?,
                created_at: row.get("created_at")?,
                target: EntryRelationshipTarget {
                    id: row.get("target_entry_id")?,
                    title: row.get("title")?,
                    r#type: row.get("type")?,
                    status: row.get("status")?,
                    is_template: bool_from_sql(row.get("is_template")?),
                    is_favorite: bool_from_sql(row.get("is_favorite")?),
                    is_pinned: bool_from_sql(row.get("is_pinned")?),
                    preview_image_path: row.get("preview_image_path")?,
                },
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_relationship(app: AppHandle, input: RelationshipInput) -> CommandResult<()> {
    if input.source_entry_id == input.target_entry_id {
        return Err("An entry cannot be related to itself.".to_string());
    }

    let connection = open_db(&app)?;
    let source_exists = get_entry_by_id(&connection, &input.source_entry_id)?.is_some();
    let target_exists = get_entry_by_id(&connection, &input.target_entry_id)?.is_some();

    if !source_exists || !target_exists {
        return Err("Both entries must exist before creating a relationship.".to_string());
    }

    connection
        .execute(
            "
            INSERT INTO entry_relationships (
              id,
              source_entry_id,
              target_entry_id,
              relationship_type,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
            ",
            params![
                Uuid::new_v4().to_string(),
                input.source_entry_id,
                input.target_entry_id,
                input.relationship_type,
                now_iso(),
            ],
        )
        .map_err(|error| {
            if error.to_string().contains("UNIQUE constraint failed") {
                "That relationship already exists.".to_string()
            } else {
                error.to_string()
            }
        })?;

    Ok(())
}

#[tauri::command]
fn delete_relationship(app: AppHandle, id: String) -> CommandResult<()> {
    let connection = open_db(&app)?;
    connection
        .execute("DELETE FROM entry_relationships WHERE id = ?", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn duplicate_template(
    app: AppHandle,
    input: TemplateDuplicationInput,
) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let template = get_entry_by_id(&connection, &input.template_entry_id)?
        .ok_or_else(|| "Template entry not found.".to_string())?;

    if !template.is_template {
        return Err("Only entries marked as templates can be duplicated.".to_string());
    }

    let destination_parent = PathBuf::from(input.destination_parent_path.trim());
    if !destination_parent.is_dir() {
        return Err("Destination parent folder does not exist.".to_string());
    }

    let new_project_name = input.new_project_name.trim();
    if new_project_name.is_empty() {
        return Err("A new project name is required.".to_string());
    }

    let source_root = PathBuf::from(template.root_path.trim());
    if !source_root.is_dir() {
        return Err("The template root path must be an existing folder.".to_string());
    }

    let new_root = destination_parent.join(new_project_name);
    if new_root.exists() {
        return Err("A folder with that destination name already exists.".to_string());
    }

    copy_directory_filtered(&source_root, &new_root)?;

    let remapped_entry_file_path =
        remap_entry_file_path(&source_root, &new_root, template.entry_file_path.trim());

    let duplicated_input = VaultEntryInput {
        title: new_project_name.to_string(),
        description: template.description.clone(),
        r#type: template.r#type.clone(),
        tags: template.tags.clone(),
        stack: template.stack.clone(),
        root_path: new_root.to_string_lossy().to_string(),
        entry_file_path: remapped_entry_file_path,
        preview_image_path: template.preview_image_path.clone(),
        preview_images: template.preview_images.clone(),
        is_favorite: false,
        is_pinned: false,
        is_template: false,
        notes: template.notes.clone(),
        good_for: template.good_for.clone(),
        setup_notes: template.setup_notes.clone(),
        dependency_notes: template.dependency_notes.clone(),
        run_command: template.run_command.clone(),
        status: "draft".to_string(),
    };

    create_entry(app, duplicated_input)
}

fn remap_entry_file_path(source_root: &Path, new_root: &Path, original_entry_file_path: &str) -> String {
    if original_entry_file_path.trim().is_empty() {
        return String::new();
    }

    let original_entry_path = PathBuf::from(original_entry_file_path);
    match original_entry_path.strip_prefix(source_root) {
        Ok(relative) => new_root.join(relative).to_string_lossy().to_string(),
        Err(_) => String::new(),
    }
}

fn copy_directory_filtered(source: &Path, destination: &Path) -> CommandResult<()> {
    copy_directory_filtered_with_count(source, destination).map(|_| ())
}

fn should_exclude_path(name: &str, path: &Path) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "dist"
            | "build"
            | "out"
            | "target"
            | ".next"
            | ".nuxt"
            | ".svelte-kit"
            | "coverage"
            | "__pycache__"
            | ".pytest_cache"
            | ".venv"
            | "venv"
    ) || path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pyc"))
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut last_was_dash = false;

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            output.push('-');
            last_was_dash = true;
        }
    }

    let normalized = output.trim_matches('-').to_string();
    if normalized.is_empty() {
        "code-vault-item".to_string()
    } else {
        normalized
    }
}

fn file_name_or_slug(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| slugify(fallback))
}

fn unique_directory_path(parent: &Path, preferred_name: &str) -> PathBuf {
    let trimmed = preferred_name.trim();
    let base_name = if trimmed.is_empty() {
        "code-vault-item".to_string()
    } else {
        trimmed.to_string()
    };

    let initial = parent.join(&base_name);
    if !initial.exists() {
        return initial;
    }

    let mut index = 2usize;
    loop {
        let candidate = parent.join(format!("{base_name}-{index}"));
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let file = fs::File::create(path).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(file, value).map_err(|error| error.to_string())
}

fn read_json_file<T: DeserializeOwned>(path: &Path) -> CommandResult<T> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn copy_file_ensuring_parent(source: &Path, destination: &Path) -> CommandResult<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_directory_filtered_with_count(source: &Path, destination: &Path) -> CommandResult<usize> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let mut copied_files = 0usize;

    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if should_exclude_path(&file_name, &path) {
            continue;
        }

        let target = destination.join(entry.file_name());
        let metadata = entry.metadata().map_err(|error| error.to_string())?;

        if metadata.is_dir() {
            copied_files += copy_directory_filtered_with_count(&path, &target)?;
        } else if metadata.is_file() {
            copy_file_ensuring_parent(&path, &target)?;
            copied_files += 1;
        }
    }

    Ok(copied_files)
}

fn entry_file_relative_path(root_path: &str, entry_file_path: &str) -> String {
    if root_path.trim().is_empty() || entry_file_path.trim().is_empty() {
        return String::new();
    }

    let root = Path::new(root_path.trim());
    let entry = Path::new(entry_file_path.trim());
    entry.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn copy_preview_assets_to_relative_dir(
    preview_images: &[PreviewImage],
    bundle_root: &Path,
    relative_dir: &Path,
    warnings: &mut Vec<String>,
) -> CommandResult<Vec<PortablePreviewAsset>> {
    let preview_root = bundle_root.join(relative_dir);
    fs::create_dir_all(&preview_root).map_err(|error| error.to_string())?;

    let mut exported = Vec::new();
    for (index, image) in preview_images.iter().enumerate() {
        if image.path.trim().is_empty() {
            continue;
        }

        let source = PathBuf::from(image.path.trim());
        if !source.is_file() {
            warnings.push(format!("Preview missing during export: {}", image.path));
            continue;
        }

        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("png");
        let file_name = format!("{index}-{}.{}", slugify(&image.id), extension);
        let relative_path = relative_dir
            .join(&file_name)
            .to_string_lossy()
            .to_string();
        let destination = bundle_root.join(&relative_path);
        copy_file_ensuring_parent(&source, &destination)?;
        exported.push(PortablePreviewAsset {
            relative_path,
            original_name: source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("preview")
                .to_string(),
        });
    }

    Ok(exported)
}

fn copy_preview_assets_into_bundle(
    preview_images: &[PreviewImage],
    bundle_root: &Path,
    warnings: &mut Vec<String>,
) -> CommandResult<Vec<PortablePreviewAsset>> {
    copy_preview_assets_to_relative_dir(
        preview_images,
        bundle_root,
        Path::new(PORTABLE_ENTRY_PREVIEWS_DIR),
        warnings,
    )
}

fn restore_preview_assets_from_bundle(
    app: &AppHandle,
    bundle_root: &Path,
    previews: &[PortablePreviewAsset],
    warnings: &mut Vec<String>,
) -> CommandResult<Vec<PreviewImage>> {
    let mut restored = Vec::new();
    for (index, preview) in previews.iter().enumerate() {
        let source = bundle_root.join(&preview.relative_path);
        if !source.is_file() {
            warnings.push(format!(
                "Preview asset could not be restored because it is missing from the bundle: {}",
                preview.relative_path
            ));
            continue;
        }

        let copied_path = copy_preview_image_into_app(app, &source.to_string_lossy())?;
        restored.push(PreviewImage {
            id: Uuid::new_v4().to_string(),
            path: copied_path,
            order: index as i64,
            created_at: now_iso(),
            is_missing: false,
        });
    }

    Ok(restored)
}

fn collect_relationship_summaries(
    connection: &Connection,
    entry_id: &str,
) -> CommandResult<Vec<PortableRelationshipSummary>> {
    let relationships = list_relationships_for_export(connection, entry_id)?;
    Ok(relationships
        .into_iter()
        .map(|relationship| PortableRelationshipSummary {
            relationship_type: relationship.relationship_type,
            target_title: relationship.target.title,
            target_type: relationship.target.r#type,
            target_status: relationship.target.status,
        })
        .collect())
}

fn list_relationships_for_export(
    connection: &Connection,
    entry_id: &str,
) -> CommandResult<Vec<EntryRelationship>> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              r.id,
              r.source_entry_id,
              r.target_entry_id,
              r.relationship_type,
              r.created_at,
              e.title,
              e.type,
              e.status,
              e.is_template,
              e.is_favorite,
              e.is_pinned,
              e.preview_image_path
            FROM entry_relationships r
            JOIN entries e ON e.id = r.target_entry_id
            WHERE r.source_entry_id = ?
            ORDER BY datetime(r.created_at) DESC, LOWER(e.title) ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![entry_id], |row| {
            Ok(EntryRelationship {
                id: row.get("id")?,
                source_entry_id: row.get("source_entry_id")?,
                target_entry_id: row.get("target_entry_id")?,
                relationship_type: row.get("relationship_type")?,
                created_at: row.get("created_at")?,
                target: EntryRelationshipTarget {
                    id: row.get("target_entry_id")?,
                    title: row.get("title")?,
                    r#type: row.get("type")?,
                    status: row.get("status")?,
                    is_template: bool_from_sql(row.get("is_template")?),
                    is_favorite: bool_from_sql(row.get("is_favorite")?),
                    is_pinned: bool_from_sql(row.get("is_pinned")?),
                    preview_image_path: row.get("preview_image_path")?,
                },
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn list_all_backup_relationships(
    connection: &Connection,
) -> CommandResult<Vec<VaultBackupRelationship>> {
    let mut statement = connection
        .prepare(
            "
            SELECT source_entry_id, target_entry_id, relationship_type
            FROM entry_relationships
            ORDER BY datetime(created_at) ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(VaultBackupRelationship {
                source_old_id: row.get("source_entry_id")?,
                target_old_id: row.get("target_entry_id")?,
                relationship_type: row.get("relationship_type")?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn duplicate_matches_for_candidate(
    connection: &Connection,
    title: &str,
    root_path: &str,
    entry_file_path: &str,
) -> CommandResult<Vec<DuplicateMatch>> {
    let title_lower = title.trim().to_lowercase();
    let normalized_root = if root_path.trim().is_empty() {
        String::new()
    } else {
        normalize_compare_path(Path::new(root_path.trim()))
    };
    let normalized_entry_file = if entry_file_path.trim().is_empty() {
        String::new()
    } else {
        normalize_compare_path(Path::new(entry_file_path.trim()))
    };

    let mut matches = Vec::new();
    for row in get_all_entry_rows(connection)? {
        if !normalized_root.is_empty()
            && normalize_compare_path(Path::new(row.root_path.trim())) == normalized_root
        {
            matches.push(DuplicateMatch {
                r#type: "root-path".to_string(),
                entry_id: row.id.clone(),
                title: row.title.clone(),
                detail: row.root_path.clone(),
            });
        }

        if !title_lower.is_empty() && row.title.trim().to_lowercase() == title_lower {
            matches.push(DuplicateMatch {
                r#type: "title".to_string(),
                entry_id: row.id.clone(),
                title: row.title.clone(),
                detail: row.title.clone(),
            });
        }

        if !normalized_entry_file.is_empty()
            && !row.entry_file_path.trim().is_empty()
            && normalize_compare_path(Path::new(row.entry_file_path.trim())) == normalized_entry_file
        {
            matches.push(DuplicateMatch {
                r#type: "entry-file".to_string(),
                entry_id: row.id.clone(),
                title: row.title.clone(),
                detail: row.entry_file_path.clone(),
            });
        }
    }

    Ok(matches)
}

fn build_portable_entry_record(
    entry: &VaultEntry,
    previews: Vec<PortablePreviewAsset>,
    source_included: bool,
    source_file_count: usize,
) -> PortableEntryRecord {
    let root_folder_name = if entry.root_path.trim().is_empty() {
        slugify(&entry.title)
    } else {
        file_name_or_slug(Path::new(entry.root_path.trim()), &entry.title)
    };

    PortableEntryRecord {
        title: entry.title.clone(),
        description: entry.description.clone(),
        r#type: entry.r#type.clone(),
        tags: entry.tags.clone(),
        stack: entry.stack.clone(),
        is_favorite: entry.is_favorite,
        is_pinned: entry.is_pinned,
        is_template: entry.is_template,
        notes: entry.notes.clone(),
        good_for: entry.good_for.clone(),
        setup_notes: entry.setup_notes.clone(),
        dependency_notes: entry.dependency_notes.clone(),
        run_command: entry.run_command.clone(),
        status: entry.status.clone(),
        root_folder_name,
        source_relative_dir: PORTABLE_ENTRY_FILES_DIR.to_string(),
        source_included,
        source_file_count,
        entry_file_relative_path: entry_file_relative_path(&entry.root_path, &entry.entry_file_path),
        previews,
    }
}

fn portable_manifest_path(package_root: &Path) -> PathBuf {
    package_root.join(PORTABLE_MANIFEST_FILE)
}

fn load_entry_bundle_manifest(package_root: &Path) -> CommandResult<EntryBundleManifest> {
    let manifest: EntryBundleManifest = read_json_file(&portable_manifest_path(package_root))?;
    if manifest.kind != PORTABLE_ENTRY_KIND {
        return Err("The selected folder is not a Code Vault entry bundle.".to_string());
    }
    if manifest.format_version != PORTABLE_FORMAT_VERSION {
        return Err("This entry bundle uses an unsupported format version.".to_string());
    }
    Ok(manifest)
}

fn load_vault_backup_manifest(package_root: &Path) -> CommandResult<VaultBackupManifest> {
    let manifest: VaultBackupManifest = read_json_file(&portable_manifest_path(package_root))?;
    if manifest.kind != PORTABLE_BACKUP_KIND {
        return Err("The selected folder is not a Code Vault vault backup.".to_string());
    }
    if manifest.format_version != PORTABLE_FORMAT_VERSION {
        return Err("This vault backup uses an unsupported format version.".to_string());
    }
    Ok(manifest)
}

fn canceled_export_result(message: &str) -> PortableExportResult {
    PortableExportResult {
        destination_path: String::new(),
        warnings: Vec::new(),
        message: message.to_string(),
    }
}

fn canceled_import_result(message: &str) -> PortableImportResult {
    PortableImportResult {
        success_count: 0,
        failure_count: 0,
        imported_entry_ids: Vec::new(),
        warnings: Vec::new(),
        message: message.to_string(),
    }
}

fn make_destination_root(parent: &Path, preferred_name: &str) -> PathBuf {
    unique_directory_path(parent, preferred_name)
}

fn select_path(path: Option<PathBuf>) -> FileSelection {
    FileSelection {
        canceled: path.is_none(),
        path: path.map(|value| value.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn scan_import_candidate(app: AppHandle, source_path: String) -> CommandResult<ImportCandidate> {
    let connection = open_db(&app)?;
    analyze_import_source(&connection, Path::new(source_path.trim()), true)
}

#[tauri::command]
fn scan_batch_import_candidates(
    app: AppHandle,
    parent_path: String,
) -> CommandResult<Vec<ImportCandidate>> {
    let connection = open_db(&app)?;
    let parent = PathBuf::from(parent_path.trim());
    if !parent.is_dir() {
        return Err("Choose an existing folder to batch import from.".to_string());
    }

    let mut candidates = Vec::new();
    let mut entries = fs::read_dir(&parent)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if should_exclude_path(&name, &path) {
            continue;
        }

        candidates.push(analyze_import_source(&connection, &path, true)?);
    }

    Ok(candidates)
}

#[tauri::command]
fn refresh_metadata(
    app: AppHandle,
    root_path: String,
    entry_file_path: String,
) -> CommandResult<ImportCandidate> {
    let connection = open_db(&app)?;
    let root = PathBuf::from(root_path.trim());
    let source = if root.is_dir() {
        root
    } else {
        PathBuf::from(entry_file_path.trim())
    };
    analyze_import_source(&connection, &source, false)
}

#[tauri::command]
fn save_import_candidates(
    app: AppHandle,
    candidates: Vec<ImportCandidate>,
) -> CommandResult<Vec<ImportSaveResult>> {
    let connection = open_db(&app)?;
    let mut results = Vec::new();

    for candidate in candidates {
        let copied_preview_images = candidate
            .preview_images
            .iter()
            .enumerate()
            .map(|(index, image)| {
                let copied_path = copy_preview_image_into_app(&app, &image.path)?;
                Ok(PreviewImage {
                    id: image.id.clone(),
                    path: copied_path,
                    order: index as i64,
                    created_at: image.created_at.clone(),
                    is_missing: false,
                })
            })
            .collect::<CommandResult<Vec<_>>>();

        let preview_images = match copied_preview_images {
            Ok(images) => images,
            Err(error) => {
                results.push(ImportSaveResult {
                    temp_id: candidate.temp_id,
                    success: false,
                    message: error,
                    entry: None,
                });
                continue;
            }
        };

        let input = VaultEntryInput {
            title: candidate.title,
            description: candidate.description,
            r#type: candidate.r#type,
            tags: candidate.tags,
            stack: candidate.stack,
            root_path: candidate.root_path,
            entry_file_path: candidate.entry_file_path,
            preview_image_path: primary_preview_path(&preview_images),
            preview_images,
            is_favorite: candidate.is_favorite,
            is_pinned: candidate.is_pinned,
            is_template: candidate.is_template,
            notes: candidate.notes,
            good_for: candidate.good_for,
            setup_notes: candidate.setup_notes,
            dependency_notes: candidate.dependency_notes,
            run_command: candidate.run_command,
            status: candidate.status,
        };

        match insert_entry(&connection, &input) {
            Ok(entry) => results.push(ImportSaveResult {
                temp_id: candidate.temp_id,
                success: true,
                message: "Imported.".to_string(),
                entry: Some(entry),
            }),
            Err(error) => results.push(ImportSaveResult {
                temp_id: candidate.temp_id,
                success: false,
                message: error,
                entry: None,
            }),
        }
    }

    Ok(results)
}

#[tauri::command]
fn inspect_quick_preview(
    root_path: String,
    preferred_path: String,
) -> CommandResult<QuickPreviewInspection> {
    let root = PathBuf::from(root_path.trim());
    if !root.is_dir() {
        return Err("The root path must point to an existing folder.".to_string());
    }

    let snapshot = scan_directory(&root)?;
    let files = previewable_file_list(&root, &snapshot);
    let default_preview_path = default_preview_path(&preferred_path, &files);

    Ok(QuickPreviewInspection {
        files,
        default_preview_path,
    })
}

#[tauri::command]
fn read_quick_preview(target_path: String, root_path: String) -> CommandResult<QuickFilePreview> {
    let path = PathBuf::from(target_path.trim());
    if target_path.trim().is_empty() {
        return Err("Choose a file to preview.".to_string());
    }

    if !path.is_file() {
        return Ok(failure_preview(
            &path,
            &root_path,
            "This file could not be found on disk.",
        ));
    }

    if !is_previewable_text_file(&path) {
        return Ok(failure_preview(
            &path,
            &root_path,
            "This file type is not available as a plain-text preview.",
        ));
    }

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > (MAX_QUICK_PREVIEW_BYTES as u64 * 2) {
        return Ok(failure_preview(
            &path,
            &root_path,
            "This file is too large for the quick preview panel.",
        ));
    }

    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if bytes.iter().any(|byte| *byte == 0) {
        return Ok(failure_preview(
            &path,
            &root_path,
            "Binary files cannot be shown in the plain-text preview.",
        ));
    }

    let text = String::from_utf8(bytes)
        .map_err(|_| "This file is not available as a plain-text preview.".to_string())?;

    let mut truncated = false;
    let mut lines = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if index >= MAX_QUICK_PREVIEW_LINES {
            truncated = true;
            break;
        }
        lines.push(line);
    }

    let mut content = lines.join("\n");
    if content.len() > MAX_QUICK_PREVIEW_BYTES {
        content.truncate(MAX_QUICK_PREVIEW_BYTES);
        truncated = true;
    } else if text.len() > content.len() {
        truncated = true;
    }

    Ok(preview_message(&path, &root_path, content, truncated))
}

#[tauri::command]
fn list_recent_activity(app: AppHandle, limit: Option<usize>) -> CommandResult<RecentActivity> {
    let connection = open_db(&app)?;
    let limit = limit.unwrap_or(6);
    Ok(RecentActivity {
        viewed: load_recent_entries(
            &connection,
            "AND last_viewed_at != ''",
            "datetime(last_viewed_at) DESC, datetime(updated_at) DESC, LOWER(title) ASC",
            limit,
        )?,
        created: load_recent_entries(
            &connection,
            "",
            "datetime(created_at) DESC, datetime(updated_at) DESC, LOWER(title) ASC",
            limit,
        )?,
        updated: load_recent_entries(
            &connection,
            "",
            "datetime(updated_at) DESC, datetime(created_at) DESC, LOWER(title) ASC",
            limit,
        )?,
    })
}

#[tauri::command]
fn mark_entry_viewed(app: AppHandle, id: String) -> CommandResult<()> {
    let connection = open_db(&app)?;
    connection
        .execute(
            "UPDATE entries SET last_viewed_at = ?, updated_at = updated_at WHERE id = ?",
            params![now_iso(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn inspect_duplicates(app: AppHandle, entry_id: String) -> CommandResult<DuplicateInspection> {
    let connection = open_db(&app)?;
    let current = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;

    let current_root = normalize_compare_path(Path::new(current.root_path.trim()));
    let current_title = current.title.trim().to_lowercase();
    let current_entry_file = if current.entry_file_path.trim().is_empty() {
        String::new()
    } else {
        normalize_compare_path(Path::new(current.entry_file_path.trim()))
    };

    let mut matches = Vec::new();
    for other in list_entries(app.clone(), None)? {
        if other.id == current.id {
            continue;
        }

        if !current_root.is_empty()
            && normalize_compare_path(Path::new(other.root_path.trim())) == current_root
        {
            matches.push(DuplicateMatch {
                r#type: "root-path".to_string(),
                entry_id: other.id.clone(),
                title: other.title.clone(),
                detail: other.root_path.clone(),
            });
        }

        if !current_title.is_empty() && other.title.trim().to_lowercase() == current_title {
            matches.push(DuplicateMatch {
                r#type: "title".to_string(),
                entry_id: other.id.clone(),
                title: other.title.clone(),
                detail: other.title.clone(),
            });
        }

        if !current_entry_file.is_empty()
            && !other.entry_file_path.trim().is_empty()
            && normalize_compare_path(Path::new(other.entry_file_path.trim())) == current_entry_file
        {
            matches.push(DuplicateMatch {
                r#type: "entry-file".to_string(),
                entry_id: other.id.clone(),
                title: other.title.clone(),
                detail: other.entry_file_path.clone(),
            });
        }
    }

    Ok(DuplicateInspection { matches })
}

#[tauri::command]
fn inspect_path_health(app: AppHandle, entry_id: String) -> CommandResult<PathHealth> {
    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;
    Ok(compute_path_health_from_values(
        &entry.root_path,
        &entry.entry_file_path,
        &entry.preview_images,
    ))
}

#[tauri::command]
fn relink_entry_paths(app: AppHandle, input: RelinkEntryPathsInput) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let current = get_entry_by_id(&connection, &input.entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;

    let old_root = current.root_path.clone();
    let mut new_root = current.root_path.clone();
    if let Some(value) = &input.new_root_path {
        if !value.trim().is_empty() {
            new_root = value.trim().to_string();
        }
    }

    let new_entry_file_path = if let Some(value) = &input.new_entry_file_path {
        value.trim().to_string()
    } else if new_root != old_root {
        replace_path_prefix(&current.entry_file_path, &old_root, &new_root)
            .unwrap_or(current.entry_file_path.clone())
    } else {
        current.entry_file_path.clone()
    };

    let replacements = input
        .preview_replacements
        .unwrap_or_default()
        .into_iter()
        .map(|replacement| (replacement.preview_id, replacement.new_source_path))
        .collect::<HashMap<_, _>>();

    let mut preview_images = Vec::new();
    for image in current.preview_images {
        let next_path = if let Some(source_path) = replacements.get(&image.id) {
            copy_preview_image_into_app(&app, source_path)?
        } else if new_root != old_root {
            replace_path_prefix(&image.path, &old_root, &new_root).unwrap_or(image.path)
        } else {
            image.path
        };

        preview_images.push(PreviewImage {
            path: next_path,
            is_missing: false,
            ..image
        });
    }

    let next_input = VaultEntryInput {
        title: current.title,
        description: current.description,
        r#type: current.r#type,
        tags: current.tags,
        stack: current.stack,
        root_path: new_root,
        entry_file_path: new_entry_file_path,
        preview_image_path: primary_preview_path(&preview_images),
        preview_images,
        is_favorite: current.is_favorite,
        is_pinned: current.is_pinned,
        is_template: current.is_template,
        notes: current.notes,
        good_for: current.good_for,
        setup_notes: current.setup_notes,
        dependency_notes: current.dependency_notes,
        run_command: current.run_command,
        status: current.status,
    };

    update_entry_record(&connection, &input.entry_id, &next_input)
}

#[tauri::command]
fn bulk_repair_paths(app: AppHandle, input: BulkPathRepairInput) -> CommandResult<BulkPathRepairResult> {
    let connection = open_db(&app)?;
    let old_prefix = input.old_prefix.trim();
    let new_prefix = input.new_prefix.trim();
    if old_prefix.is_empty() || new_prefix.is_empty() {
        return Err("Both old and new path prefixes are required.".to_string());
    }

    let entries = list_entries(app.clone(), None)?;
    let mut updated_entries = 0usize;
    let mut updated_previews = 0usize;

    for entry in entries {
        let next_root = replace_path_prefix(&entry.root_path, old_prefix, new_prefix)
            .unwrap_or(entry.root_path.clone());
        let next_entry_file = replace_path_prefix(&entry.entry_file_path, old_prefix, new_prefix)
            .unwrap_or(entry.entry_file_path.clone());

        let mut preview_changed = 0usize;
        let next_preview_images = entry
            .preview_images
            .iter()
            .map(|image| {
                let next_path = replace_path_prefix(&image.path, old_prefix, new_prefix)
                    .unwrap_or(image.path.clone());
                if next_path != image.path {
                    preview_changed += 1;
                }
                PreviewImage {
                    path: next_path,
                    is_missing: false,
                    ..image.clone()
                }
            })
            .collect::<Vec<_>>();

        let entry_changed = next_root != entry.root_path
            || next_entry_file != entry.entry_file_path
            || preview_changed > 0;

        if !entry_changed {
            continue;
        }

        updated_entries += 1;
        updated_previews += preview_changed;

        let next_input = VaultEntryInput {
            title: entry.title,
            description: entry.description,
            r#type: entry.r#type,
            tags: entry.tags,
            stack: entry.stack,
            root_path: next_root,
            entry_file_path: next_entry_file,
            preview_image_path: primary_preview_path(&next_preview_images),
            preview_images: next_preview_images,
            is_favorite: entry.is_favorite,
            is_pinned: entry.is_pinned,
            is_template: entry.is_template,
            notes: entry.notes,
            good_for: entry.good_for,
            setup_notes: entry.setup_notes,
            dependency_notes: entry.dependency_notes,
            run_command: entry.run_command,
            status: entry.status,
        };

        update_entry_record(&connection, &entry.id, &next_input)?;
    }

    Ok(BulkPathRepairResult {
        updated_entries,
        updated_previews,
    })
}

#[tauri::command]
fn attach_preview_image_to_entry(
    app: AppHandle,
    entry_id: String,
    source_path: String,
) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;
    let copied_path = copy_preview_image_into_app(&app, &source_path)?;
    let mut preview_images = entry.preview_images;
    preview_images.push(PreviewImage {
        id: Uuid::new_v4().to_string(),
        path: copied_path,
        order: preview_images.len() as i64,
        created_at: now_iso(),
        is_missing: false,
    });

    let input = VaultEntryInput {
        title: entry.title,
        description: entry.description,
        r#type: entry.r#type,
        tags: entry.tags,
        stack: entry.stack,
        root_path: entry.root_path,
        entry_file_path: entry.entry_file_path,
        preview_image_path: primary_preview_path(&preview_images),
        preview_images,
        is_favorite: entry.is_favorite,
        is_pinned: entry.is_pinned,
        is_template: entry.is_template,
        notes: entry.notes,
        good_for: entry.good_for,
        setup_notes: entry.setup_notes,
        dependency_notes: entry.dependency_notes,
        run_command: entry.run_command,
        status: entry.status,
    };

    update_entry_record(&connection, &entry_id, &input)
}

#[tauri::command]
fn remove_preview_image(app: AppHandle, entry_id: String, preview_id: String) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;
    let preview_images = entry
        .preview_images
        .into_iter()
        .filter(|image| image.id != preview_id)
        .enumerate()
        .map(|(index, mut image)| {
            image.order = index as i64;
            image
        })
        .collect::<Vec<_>>();

    let input = VaultEntryInput {
        title: entry.title,
        description: entry.description,
        r#type: entry.r#type,
        tags: entry.tags,
        stack: entry.stack,
        root_path: entry.root_path,
        entry_file_path: entry.entry_file_path,
        preview_image_path: primary_preview_path(&preview_images),
        preview_images,
        is_favorite: entry.is_favorite,
        is_pinned: entry.is_pinned,
        is_template: entry.is_template,
        notes: entry.notes,
        good_for: entry.good_for,
        setup_notes: entry.setup_notes,
        dependency_notes: entry.dependency_notes,
        run_command: entry.run_command,
        status: entry.status,
    };

    update_entry_record(&connection, &entry_id, &input)
}

#[tauri::command]
fn move_preview_image(
    app: AppHandle,
    entry_id: String,
    preview_id: String,
    direction: String,
) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;
    let mut preview_images = entry.preview_images;
    let Some(current_index) = preview_images.iter().position(|image| image.id == preview_id) else {
        return Err("Preview image not found.".to_string());
    };

    let target_index = match direction.as_str() {
        "left" if current_index > 0 => current_index - 1,
        "right" if current_index + 1 < preview_images.len() => current_index + 1,
        _ => current_index,
    };
    preview_images.swap(current_index, target_index);
    for (index, image) in preview_images.iter_mut().enumerate() {
        image.order = index as i64;
    }

    let input = VaultEntryInput {
        title: entry.title,
        description: entry.description,
        r#type: entry.r#type,
        tags: entry.tags,
        stack: entry.stack,
        root_path: entry.root_path,
        entry_file_path: entry.entry_file_path,
        preview_image_path: primary_preview_path(&preview_images),
        preview_images,
        is_favorite: entry.is_favorite,
        is_pinned: entry.is_pinned,
        is_template: entry.is_template,
        notes: entry.notes,
        good_for: entry.good_for,
        setup_notes: entry.setup_notes,
        dependency_notes: entry.dependency_notes,
        run_command: entry.run_command,
        status: entry.status,
    };

    update_entry_record(&connection, &entry_id, &input)
}

#[tauri::command]
fn export_entry_metadata(app: AppHandle, entry_id: String) -> CommandResult<PortableExportResult> {
    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;
    let relationships = collect_relationship_summaries(&connection, &entry.id)?;
    let default_name = format!("{}-metadata.json", slugify(&entry.title));
    let Some(destination) = FileDialog::new().set_file_name(&default_name).save_file() else {
        return Ok(canceled_export_result("Metadata export canceled."));
    };

    let payload = serde_json::json!({
        "kind": "entry-metadata",
        "formatVersion": PORTABLE_FORMAT_VERSION,
        "exportedAt": now_iso(),
        "entry": entry,
        "relationships": relationships
    });
    write_json_file(&destination, &payload)?;

    Ok(PortableExportResult {
        destination_path: destination.to_string_lossy().to_string(),
        warnings: Vec::new(),
        message: "Entry metadata exported.".to_string(),
    })
}

#[tauri::command]
fn export_entry_bundle(app: AppHandle, entry_id: String) -> CommandResult<PortableExportResult> {
    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;

    let Some(destination_parent) = FileDialog::new().pick_folder() else {
        return Ok(canceled_export_result("Entry bundle export canceled."));
    };

    let package_root = make_destination_root(
        &destination_parent,
        &format!("{}-{}.cvbundle", slugify(&entry.title), timestamp_millis()),
    );
    fs::create_dir_all(&package_root).map_err(|error| error.to_string())?;

    let mut warnings = Vec::new();
    let previews = copy_preview_assets_into_bundle(&entry.preview_images, &package_root, &mut warnings)?;
    let mut source_included = false;
    let mut source_file_count = 0usize;

    if !entry.root_path.trim().is_empty() {
        let source_root = PathBuf::from(entry.root_path.trim());
        if source_root.is_dir() {
            source_file_count = copy_directory_filtered_with_count(
                &source_root,
                &package_root.join(PORTABLE_ENTRY_FILES_DIR),
            )?;
            source_included = true;
        } else {
            warnings.push(format!(
                "The source root could not be included because it is missing: {}",
                entry.root_path
            ));
        }
    }

    let relationships = collect_relationship_summaries(&connection, &entry.id)?;
    let manifest = EntryBundleManifest {
        kind: PORTABLE_ENTRY_KIND.to_string(),
        format_version: PORTABLE_FORMAT_VERSION.to_string(),
        exported_at: now_iso(),
        entry: build_portable_entry_record(&entry, previews, source_included, source_file_count),
        relationships,
        warnings: warnings.clone(),
    };
    write_json_file(&portable_manifest_path(&package_root), &manifest)?;

    Ok(PortableExportResult {
        destination_path: package_root.to_string_lossy().to_string(),
        warnings,
        message: "Entry bundle exported.".to_string(),
    })
}

#[tauri::command]
fn inspect_entry_bundle(app: AppHandle) -> CommandResult<Option<EntryBundleInspection>> {
    let Some(package_root) = FileDialog::new().pick_folder() else {
        return Ok(None);
    };

    let manifest = load_entry_bundle_manifest(&package_root)?;
    let connection = open_db(&app)?;
    let duplicate_matches =
        duplicate_matches_for_candidate(&connection, &manifest.entry.title, "", "")?;

    Ok(Some(EntryBundleInspection {
        package_path: package_root.to_string_lossy().to_string(),
        display_name: package_root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Entry bundle")
            .to_string(),
        title: manifest.entry.title,
        r#type: manifest.entry.r#type,
        preview_count: manifest.entry.previews.len(),
        includes_source_files: manifest.entry.source_included,
        source_file_count: manifest.entry.source_file_count,
        relationship_count: manifest.relationships.len(),
        warnings: manifest.warnings,
        duplicate_matches,
    }))
}

#[tauri::command]
fn import_entry_bundle(app: AppHandle, package_path: String) -> CommandResult<PortableImportResult> {
    let package_root = PathBuf::from(package_path.trim());
    let manifest = load_entry_bundle_manifest(&package_root)?;
    let Some(destination_parent) = FileDialog::new().pick_folder() else {
        return Ok(canceled_import_result("Entry bundle import canceled."));
    };

    let destination_root = make_destination_root(&destination_parent, &manifest.entry.root_folder_name);
    let mut warnings = manifest.warnings.clone();
    if manifest.entry.source_included {
        let source_root = package_root.join(&manifest.entry.source_relative_dir);
        if source_root.is_dir() {
            copy_directory_filtered_with_count(&source_root, &destination_root)?;
        } else {
            warnings.push(format!(
                "Source files were marked as included, but the bundle folder is missing: {}",
                manifest.entry.source_relative_dir
            ));
            fs::create_dir_all(&destination_root).map_err(|error| error.to_string())?;
        }
    } else {
        fs::create_dir_all(&destination_root).map_err(|error| error.to_string())?;
    }

    let preview_images =
        restore_preview_assets_from_bundle(&app, &package_root, &manifest.entry.previews, &mut warnings)?;
    let entry_file_path = if manifest.entry.entry_file_relative_path.trim().is_empty() {
        String::new()
    } else {
        destination_root
            .join(manifest.entry.entry_file_relative_path.trim())
            .to_string_lossy()
            .to_string()
    };

    let connection = open_db(&app)?;
    for duplicate in duplicate_matches_for_candidate(
        &connection,
        &manifest.entry.title,
        &destination_root.to_string_lossy(),
        &entry_file_path,
    )? {
        warnings.push(format!(
            "Possible duplicate detected while importing: {} ({})",
            duplicate.title, duplicate.r#type
        ));
    }

    let input = VaultEntryInput {
        title: manifest.entry.title,
        description: manifest.entry.description,
        r#type: manifest.entry.r#type,
        tags: manifest.entry.tags,
        stack: manifest.entry.stack,
        root_path: destination_root.to_string_lossy().to_string(),
        entry_file_path,
        preview_image_path: primary_preview_path(&preview_images),
        preview_images,
        is_favorite: manifest.entry.is_favorite,
        is_pinned: manifest.entry.is_pinned,
        is_template: manifest.entry.is_template,
        notes: manifest.entry.notes,
        good_for: manifest.entry.good_for,
        setup_notes: manifest.entry.setup_notes,
        dependency_notes: manifest.entry.dependency_notes,
        run_command: manifest.entry.run_command,
        status: manifest.entry.status,
    };

    match insert_entry(&connection, &input) {
        Ok(entry) => Ok(PortableImportResult {
            success_count: 1,
            failure_count: 0,
            imported_entry_ids: vec![entry.id],
            warnings,
            message: "Entry bundle imported.".to_string(),
        }),
        Err(error) => Ok(PortableImportResult {
            success_count: 0,
            failure_count: 1,
            imported_entry_ids: Vec::new(),
            warnings,
            message: error,
        }),
    }
}

#[tauri::command]
fn export_vault_backup(app: AppHandle) -> CommandResult<PortableExportResult> {
    let connection = open_db(&app)?;
    let Some(destination_parent) = FileDialog::new().pick_folder() else {
        return Ok(canceled_export_result("Vault backup export canceled."));
    };

    let backup_root = make_destination_root(
        &destination_parent,
        &format!("code-vault-backup-{}.cvbackup", timestamp_millis()),
    );
    fs::create_dir_all(&backup_root).map_err(|error| error.to_string())?;

    let current_db_path = db_path(&app)?;
    if current_db_path.is_file() {
        copy_file_ensuring_parent(&current_db_path, &backup_root.join(PORTABLE_BACKUP_DB_FILE))?;
    }

    let mut warnings = Vec::new();
    let entry_rows = get_all_entry_rows(&connection)?;
    let mut backup_entries = Vec::new();

    for row in entry_rows {
        let entry = hydrate_entry(&connection, row)?;
        let preview_relative_dir = Path::new(PORTABLE_BACKUP_PREVIEWS_DIR).join(&entry.id);
        let previews = copy_preview_assets_to_relative_dir(
            &entry.preview_images,
            &backup_root,
            &preview_relative_dir,
            &mut warnings,
        )?;

        let mut record = build_portable_entry_record(&entry, previews, false, 0);
        record.source_relative_dir = Path::new(PORTABLE_BACKUP_SOURCES_DIR)
            .join(&entry.id)
            .to_string_lossy()
            .to_string();

        if !entry.root_path.trim().is_empty() {
            let source_root = PathBuf::from(entry.root_path.trim());
            if source_root.is_dir() {
                record.source_file_count = copy_directory_filtered_with_count(
                    &source_root,
                    &backup_root.join(&record.source_relative_dir),
                )?;
                record.source_included = true;
            } else {
                warnings.push(format!(
                    "Source files for \"{}\" were skipped because the root path is missing.",
                    entry.title
                ));
            }
        }

        backup_entries.push(VaultBackupEntry {
            old_id: entry.id,
            entry: record,
        });
    }

    let manifest = VaultBackupManifest {
        kind: PORTABLE_BACKUP_KIND.to_string(),
        format_version: PORTABLE_FORMAT_VERSION.to_string(),
        exported_at: now_iso(),
        entries: backup_entries,
        relationships: list_all_backup_relationships(&connection)?,
        warnings: warnings.clone(),
    };
    write_json_file(&portable_manifest_path(&backup_root), &manifest)?;

    Ok(PortableExportResult {
        destination_path: backup_root.to_string_lossy().to_string(),
        warnings,
        message: "Vault backup exported.".to_string(),
    })
}

#[tauri::command]
fn inspect_vault_backup(app: AppHandle) -> CommandResult<Option<VaultBackupInspection>> {
    let Some(package_root) = FileDialog::new().pick_folder() else {
        return Ok(None);
    };

    let manifest = load_vault_backup_manifest(&package_root)?;
    let connection = open_db(&app)?;
    let mut duplicate_matches = Vec::new();
    for entry in &manifest.entries {
        duplicate_matches.extend(duplicate_matches_for_candidate(
            &connection,
            &entry.entry.title,
            "",
            "",
        )?);
        if duplicate_matches.len() >= 24 {
            duplicate_matches.truncate(24);
            break;
        }
    }

    Ok(Some(VaultBackupInspection {
        package_path: package_root.to_string_lossy().to_string(),
        display_name: package_root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Vault backup")
            .to_string(),
        entry_count: manifest.entries.len(),
        relationship_count: manifest.relationships.len(),
        preview_count: manifest
            .entries
            .iter()
            .map(|entry| entry.entry.previews.len())
            .sum(),
        source_bundle_count: manifest
            .entries
            .iter()
            .filter(|entry| entry.entry.source_included)
            .count(),
        warnings: manifest.warnings,
        duplicate_matches,
    }))
}

#[tauri::command]
fn restore_vault_backup(app: AppHandle, package_path: String) -> CommandResult<PortableImportResult> {
    let package_root = PathBuf::from(package_path.trim());
    let manifest = load_vault_backup_manifest(&package_root)?;
    let Some(destination_parent) = FileDialog::new().pick_folder() else {
        return Ok(canceled_import_result("Vault restore canceled."));
    };

    let connection = open_db(&app)?;
    let mut warnings = manifest.warnings.clone();
    let mut imported_entry_ids = Vec::new();
    let mut restored_id_map = HashMap::new();
    let mut failure_count = 0usize;

    for backed_up in manifest.entries {
        let destination_root =
            make_destination_root(&destination_parent, &backed_up.entry.root_folder_name);

        if backed_up.entry.source_included {
            let source_root = package_root.join(&backed_up.entry.source_relative_dir);
            if source_root.is_dir() {
                copy_directory_filtered_with_count(&source_root, &destination_root)?;
            } else {
                warnings.push(format!(
                    "Source files for \"{}\" were not found in the backup package.",
                    backed_up.entry.title
                ));
                fs::create_dir_all(&destination_root).map_err(|error| error.to_string())?;
            }
        } else {
            fs::create_dir_all(&destination_root).map_err(|error| error.to_string())?;
        }

        let preview_images = restore_preview_assets_from_bundle(
            &app,
            &package_root,
            &backed_up.entry.previews,
            &mut warnings,
        )?;
        let entry_file_path = if backed_up.entry.entry_file_relative_path.trim().is_empty() {
            String::new()
        } else {
            destination_root
                .join(backed_up.entry.entry_file_relative_path.trim())
                .to_string_lossy()
                .to_string()
        };

        for duplicate in duplicate_matches_for_candidate(
            &connection,
            &backed_up.entry.title,
            &destination_root.to_string_lossy(),
            &entry_file_path,
        )? {
            warnings.push(format!(
                "Possible duplicate detected while restoring: {} ({})",
                duplicate.title, duplicate.r#type
            ));
        }

        let input = VaultEntryInput {
            title: backed_up.entry.title.clone(),
            description: backed_up.entry.description.clone(),
            r#type: backed_up.entry.r#type.clone(),
            tags: backed_up.entry.tags.clone(),
            stack: backed_up.entry.stack.clone(),
            root_path: destination_root.to_string_lossy().to_string(),
            entry_file_path,
            preview_image_path: primary_preview_path(&preview_images),
            preview_images,
            is_favorite: backed_up.entry.is_favorite,
            is_pinned: backed_up.entry.is_pinned,
            is_template: backed_up.entry.is_template,
            notes: backed_up.entry.notes.clone(),
            good_for: backed_up.entry.good_for.clone(),
            setup_notes: backed_up.entry.setup_notes.clone(),
            dependency_notes: backed_up.entry.dependency_notes.clone(),
            run_command: backed_up.entry.run_command.clone(),
            status: backed_up.entry.status.clone(),
        };

        match insert_entry(&connection, &input) {
            Ok(entry) => {
                restored_id_map.insert(backed_up.old_id, entry.id.clone());
                imported_entry_ids.push(entry.id);
            }
            Err(error) => {
                failure_count += 1;
                warnings.push(format!(
                    "Failed to restore \"{}\": {}",
                    backed_up.entry.title, error
                ));
            }
        }
    }

    for relationship in manifest.relationships {
        let Some(source_entry_id) = restored_id_map.get(&relationship.source_old_id) else {
            continue;
        };
        let Some(target_entry_id) = restored_id_map.get(&relationship.target_old_id) else {
            continue;
        };

        let _ = connection.execute(
            "
            INSERT INTO entry_relationships (
              id,
              source_entry_id,
              target_entry_id,
              relationship_type,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
            ",
            params![
                Uuid::new_v4().to_string(),
                source_entry_id,
                target_entry_id,
                relationship.relationship_type,
                now_iso(),
            ],
        );
    }

    Ok(PortableImportResult {
        success_count: imported_entry_ids.len(),
        failure_count,
        imported_entry_ids,
        warnings,
        message: "Vault backup restore finished.".to_string(),
    })
}

#[tauri::command]
fn pick_root_path() -> FileSelection {
    select_path(FileDialog::new().pick_folder())
}

#[tauri::command]
fn pick_entry_file() -> FileSelection {
    select_path(FileDialog::new().pick_file())
}

#[tauri::command]
fn import_preview_image(app: AppHandle) -> CommandResult<FileSelection> {
    let path = FileDialog::new()
        .add_filter("Media", &["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm"])
        .pick_file();

    let Some(source_path) = path else {
        return Ok(FileSelection {
            canceled: true,
            path: None,
        });
    };

    let copied = copy_preview_image_into_app(&app, &source_path.to_string_lossy())?;

    Ok(FileSelection {
        canceled: false,
        path: Some(copied),
    })
}

#[tauri::command]
fn open_path(target_path: String) -> OpenPathResult {
    let trimmed = target_path.trim();
    if trimmed.is_empty() {
        return OpenPathResult {
            success: false,
            message: Some("No path provided.".to_string()),
        };
    }

    let path = Path::new(trimmed);
    if !path.exists() {
        return OpenPathResult {
            success: false,
            message: Some("Path does not exist on disk.".to_string()),
        };
    }

    match open_path_with_system(path) {
        Ok(_) => OpenPathResult {
            success: true,
            message: None,
        },
        Err(error) => match fallback_to_parent_folder(path) {
            Some(message) => OpenPathResult {
                success: true,
                message: Some(message),
            },
            None => OpenPathResult {
                success: false,
                message: Some(error),
            },
        },
    }
}

fn open_path_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let output = Command::new("xdg-open").arg(path).output();

    #[cfg(target_os = "macos")]
    let output = Command::new("open").arg(path).output();

    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path)
        .output();

    let output = output.map_err(|error| error.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let fallback = if path.is_file() {
        "Your system may not have a default app associated with this file type.".to_string()
    } else {
        "Your system could not open this path.".to_string()
    };

    Err(if stderr.is_empty() { fallback } else { stderr })
}

fn fallback_to_parent_folder(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }

    let parent = path.parent()?;
    if open_path_with_system(parent).is_ok() {
        return Some(
            "No default app was found for that file type, so the containing folder was opened instead."
                .to_string(),
        );
    }

    None
}

#[tauri::command]
fn copy_to_clipboard(value: String) -> CommandResult<()> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(value).map_err(|error| error.to_string())
}

#[tauri::command]
async fn paste_clipboard_image(app: AppHandle, entry_id: String) -> CommandResult<VaultEntry> {
    let app_clone = app.clone();
    let saved_path = tauri::async_runtime::spawn_blocking(move || {
        let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
        let img_data = clipboard
            .get_image()
            .map_err(|_| "No image found on the clipboard.".to_string())?;

        let width = img_data.width as u32;
        let height = img_data.height as u32;
        let rgba_bytes: Vec<u8> = img_data.bytes.into_owned();

        let buffer: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width, height, rgba_bytes)
                .ok_or_else(|| "Failed to create image buffer from clipboard data.".to_string())?;

        let preview_root = previews_dir(&app_clone)?;
        let file_name = format!("{}-clipboard.png", timestamp_millis());
        let destination = preview_root.join(&file_name);
        buffer.save(&destination).map_err(|error| error.to_string())?;

        Ok::<String, String>(destination.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    let connection = open_db(&app)?;
    let entry = get_entry_by_id(&connection, &entry_id)?
        .ok_or_else(|| "Entry not found.".to_string())?;

    let mut preview_images = entry.preview_images;
    preview_images.push(PreviewImage {
        id: Uuid::new_v4().to_string(),
        path: saved_path,
        order: preview_images.len() as i64,
        created_at: now_iso(),
        is_missing: false,
    });

    let input = VaultEntryInput {
        title: entry.title,
        description: entry.description,
        r#type: entry.r#type,
        tags: entry.tags,
        stack: entry.stack,
        root_path: entry.root_path,
        entry_file_path: entry.entry_file_path,
        preview_image_path: primary_preview_path(&preview_images),
        preview_images,
        is_favorite: entry.is_favorite,
        is_pinned: entry.is_pinned,
        is_template: entry.is_template,
        notes: entry.notes,
        good_for: entry.good_for,
        setup_notes: entry.setup_notes,
        dependency_notes: entry.dependency_notes,
        run_command: entry.run_command,
        status: entry.status,
    };

    update_entry_record(&connection, &entry_id, &input)
}

#[tauri::command]
fn run_entry_command(root_path: String, command: String) -> RunCommandResult {
    let trimmed_command = command.trim();
    if trimmed_command.is_empty() {
        return RunCommandResult {
            success: false,
            message: Some("No run command is saved for this entry.".to_string()),
        };
    }

    let root = PathBuf::from(root_path.trim());
    if !root.is_dir() {
        return RunCommandResult {
            success: false,
            message: Some("The root path must point to an existing folder.".to_string()),
        };
    }

    #[cfg(target_os = "windows")]
    let process = {
        let mut process = Command::new("cmd");
        process.args(["/C", trimmed_command]);
        process
    };

    #[cfg(not(target_os = "windows"))]
    let process = {
        let mut process = Command::new("sh");
        process.args(["-lc", trimmed_command]);
        process
    };

    let spawn_result = {
        let mut process = process;
        process
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    };

    match spawn_result {
        Ok(_) => RunCommandResult {
            success: true,
            message: Some("Run command started.".to_string()),
        },
        Err(error) => RunCommandResult {
            success: false,
            message: Some(error.to_string()),
        },
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            open_db(app.handle()).map_err(|error| {
                Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                    as Box<dyn std::error::Error>
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_entries,
            get_entry,
            create_entry,
            update_entry,
            patch_entry,
            archive_entry,
            delete_entry,
            list_tags,
            list_entry_options,
            list_relationships,
            create_relationship,
            delete_relationship,
            duplicate_template,
            scan_import_candidate,
            scan_batch_import_candidates,
            refresh_metadata,
            save_import_candidates,
            inspect_quick_preview,
            read_quick_preview,
            list_recent_activity,
            mark_entry_viewed,
            inspect_duplicates,
            inspect_path_health,
            relink_entry_paths,
            bulk_repair_paths,
            attach_preview_image_to_entry,
            remove_preview_image,
            move_preview_image,
            export_entry_metadata,
            export_entry_bundle,
            inspect_entry_bundle,
            import_entry_bundle,
            export_vault_backup,
            inspect_vault_backup,
            restore_vault_backup,
            pick_root_path,
            pick_entry_file,
            import_preview_image,
            open_path,
            copy_to_clipboard,
            paste_clipboard_image,
            run_entry_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
