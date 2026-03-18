use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use arboard::Clipboard;
use rfd::FileDialog;
use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

type CommandResult<T> = Result<T, String>;

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
    notes: String,
    status: String,
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
    notes: String,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct EntryFilters {
    query: Option<String>,
    r#type: Option<String>,
    status: Option<String>,
    include_archived: Option<bool>,
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
              notes TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    Ok(connection)
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

fn normalize_tags(tags: &[String]) -> String {
    tags.iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

fn map_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<VaultEntry> {
    let tags: String = row.get("tags")?;
    Ok(VaultEntry {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        r#type: row.get("type")?,
        tags: tags
            .split(',')
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        stack: row.get("stack")?,
        root_path: row.get("root_path")?,
        entry_file_path: row.get("entry_file_path")?,
        preview_image_path: row.get("preview_image_path")?,
        notes: row.get("notes")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn get_entry_by_id(connection: &Connection, id: &str) -> CommandResult<Option<VaultEntry>> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              id,
              title,
              description,
              type,
              tags,
              stack,
              root_path,
              entry_file_path,
              preview_image_path,
              notes,
              status,
              created_at,
              updated_at
            FROM entries
            WHERE id = ?
            ",
        )
        .map_err(|error| error.to_string())?;

    let mut rows = statement
        .query(params![id])
        .map_err(|error| error.to_string())?;
    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => Ok(Some(map_entry(row).map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

#[tauri::command]
fn list_entries(app: AppHandle, filters: Option<EntryFilters>) -> CommandResult<Vec<VaultEntry>> {
    let connection = open_db(&app)?;
    let filters = filters.unwrap_or_default();
    let query = filters.query.unwrap_or_default().trim().to_lowercase();
    let entry_type = filters.r#type.unwrap_or_else(|| "all".to_string());
    let status = filters.status.unwrap_or_else(|| "all".to_string());
    let include_archived = filters.include_archived.unwrap_or(false);

    let mut sql = String::from(
        "
        SELECT
          id,
          title,
          description,
          type,
          tags,
          stack,
          root_path,
          entry_file_path,
          preview_image_path,
          notes,
          status,
          created_at,
          updated_at
        FROM entries
        ",
    );

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

    sql.push_str(" ORDER BY datetime(updated_at) DESC, LOWER(title) ASC");

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(params_vec.iter()), map_entry)
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_entry(app: AppHandle, id: String) -> CommandResult<Option<VaultEntry>> {
    let connection = open_db(&app)?;
    get_entry_by_id(&connection, &id)
}

#[tauri::command]
fn create_entry(app: AppHandle, input: VaultEntryInput) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();

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
              notes,
              status,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                input.preview_image_path.trim(),
                input.notes.trim(),
                input.status,
                now,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;

    get_entry_by_id(&connection, &id)?.ok_or_else(|| "Failed to create entry.".to_string())
}

#[tauri::command]
fn update_entry(app: AppHandle, id: String, input: VaultEntryInput) -> CommandResult<VaultEntry> {
    let connection = open_db(&app)?;
    let now = now_iso();

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
              notes = ?,
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
                input.preview_image_path.trim(),
                input.notes.trim(),
                input.status,
                now,
                id,
            ],
        )
        .map_err(|error| error.to_string())?;

    get_entry_by_id(&connection, &id)?.ok_or_else(|| "Failed to update entry.".to_string())
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

fn select_path(path: Option<PathBuf>) -> FileSelection {
    FileSelection {
        canceled: path.is_none(),
        path: path.map(|value| value.to_string_lossy().to_string()),
    }
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
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
        .pick_file();

    let Some(source_path) = path else {
        return Ok(FileSelection {
            canceled: true,
            path: None,
        });
    };

    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("preview");
    let copied_name = format!("{}-{}.{}", timestamp_millis(), stem, extension);
    let destination = previews_dir(&app)?.join(copied_name);

    fs::copy(&source_path, &destination).map_err(|error| error.to_string())?;

    Ok(FileSelection {
        canceled: false,
        path: Some(destination.to_string_lossy().to_string()),
    })
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
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
            archive_entry,
            delete_entry,
            pick_root_path,
            pick_entry_file,
            import_preview_image,
            open_path,
            copy_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
