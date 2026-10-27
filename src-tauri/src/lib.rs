//! Ink —— 极简 Markdown 写作软件（Tauri 2 后端）
//!
//! 设计要点：
//! - 所有文件写入走「临时文件 + fsync + rename」的原子写，并带 mtime 乐观锁
//! - 库目录可自定义，监听随之切换
//! - 编码永远以 UTF-8 写出，读取时兼容 GBK
mod access;
mod encoding;
mod folders;
mod fs_ops;
mod open_requests;
mod search;
mod tags;
mod watcher;
mod window_theme;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;

use access::AccessState;
use open_requests::OpenRequests;

use fs_ops::{CommandError, DocumentMeta, ReadDocumentResult, WriteResult};
use search::SearchHit;

/// 应用设置文件（AppSettings / UI 快照 / 已授权的文档库）
const SETTINGS_STORE: &str = "settings.json";

fn to_path(path: &str) -> PathBuf {
    PathBuf::from(path)
}

type AccessGuard<'a> = std::sync::MutexGuard<'a, access::Access>;

fn lock<'a>(state: &'a State<'_, AccessState>) -> AccessGuard<'a> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

fn store_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new("settingsIo", error.to_string())
}

// ── 文档库授权 ──────────────────────────────────────────────

/// settings.json 中由 Rust 独占的键：已授权的文档库路径（前端无法写入）
const LIBRARY_KEY: &str = "authorizedLibrary";
/// 前端可读写的持久化键（其余键一律拒绝，见 load_persisted / save_persisted）
const PERSISTED_KEYS: [&str; 2] = ["settings", "ui"];

fn persist_library(app: &AppHandle, root: &Path) -> Result<(), CommandError> {
    let store = app.store(SETTINGS_STORE).map_err(store_error)?;
    store.set(LIBRARY_KEY, root.to_string_lossy().to_string());
    store.save().map_err(store_error)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryStatus {
    /// 已授权的文档库；exists = false 时为已失效的旧路径
    path: Option<String>,
    exists: bool,
}

/// 启动时读取已授权的文档库。
/// 旧版本只把路径存在前端的 settings.libraryPath 里：首次升级时迁移一次，之后只认 Rust 写入的键。
#[tauri::command]
fn get_library(
    app: AppHandle,
    state: State<'_, AccessState>,
) -> Result<LibraryStatus, CommandError> {
    if let Some(root) = lock(&state).library() {
        return Ok(LibraryStatus {
            path: Some(root.to_string_lossy().to_string()),
            exists: root.is_dir(),
        });
    }

    let store = app.store(SETTINGS_STORE).map_err(store_error)?;
    let authorized = store
        .get(LIBRARY_KEY)
        .and_then(|value| value.as_str().map(str::to_string));
    let migrated = authorized.is_none();
    let candidate = authorized.or_else(|| {
        store
            .get("settings")
            .and_then(|settings| settings.get("libraryPath")?.as_str().map(str::to_string))
            .filter(|path| !path.is_empty())
    });

    let Some(candidate) = candidate else {
        return Ok(LibraryStatus {
            path: None,
            exists: false,
        });
    };
    match lock(&state).set_library(Path::new(&candidate)) {
        Ok(root) => {
            if migrated {
                persist_library(&app, &root)?;
            }
            Ok(LibraryStatus {
                path: Some(root.to_string_lossy().to_string()),
                exists: true,
            })
        }
        Err(_) => Ok(LibraryStatus {
            path: Some(candidate),
            exists: false,
        }),
    }
}

/// 首次启动选库（spec W7）：use_default = 默认 ~/Documents/Ink，否则弹出目录选择框。
/// 取消返回 None。
#[tauri::command]
async fn choose_library(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccessState>,
    use_default: bool,
) -> Result<Option<String>, CommandError> {
    let picked = if use_default {
        let documents = app
            .path()
            .document_dir()
            .map_err(|e| CommandError::new("documentsDirMissing", e.to_string()))?;
        documents.join("Ink")
    } else {
        match app
            .dialog()
            .file()
            .set_parent(&window)
            .blocking_pick_folder()
        {
            Some(path) => path
                .into_path()
                .map_err(|e| CommandError::new("dialogFailed", e.to_string()))?,
            None => return Ok(None),
        }
    };
    std::fs::create_dir_all(&picked).map_err(|e| {
        CommandError::new("createDirFailed", format!("{} ({})", picked.display(), e))
    })?;

    let root = lock(&state).set_library(&picked)?;
    persist_library(&app, &root)?;
    Ok(Some(root.to_string_lossy().to_string()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeLibraryResult {
    path: String,
    copied: u64,
    skipped: u64,
}

/// 更换文档库：弹出目录选择框 → 复制现有文档（同名跳过、不删旧库）→ 切换授权。取消返回 None。
#[tauri::command]
async fn change_library(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccessState>,
) -> Result<Option<ChangeLibraryResult>, CommandError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let picked = picked
        .into_path()
        .map_err(|e| CommandError::new("dialogFailed", e.to_string()))?;
    let target = access::normalize(&picked)?;

    let current = lock(&state).library().map(Path::to_path_buf);
    // 新旧位置互相包含：复制时会把刚复制出来的目录再复制一遍，一路嵌套到路径超长
    if let Some(old) = &current {
        if old != &target && (target.starts_with(old) || old.starts_with(&target)) {
            return Err(CommandError::new(
                "libraryNested",
                target.display().to_string(),
            ));
        }
    }
    let stats = match &current {
        Some(old) if old != &target => fs_ops::copy_library(old, &target)?,
        _ => fs_ops::CopyStats {
            copied: 0,
            skipped: 0,
        },
    };

    let root = lock(&state).set_library(&target)?;
    persist_library(&app, &root)?;
    Ok(Some(ChangeLibraryResult {
        path: root.to_string_lossy().to_string(),
        copied: stats.copied,
        skipped: stats.skipped,
    }))
}

/// ⌘O：弹出文件选择框，授权所选的库外文档。取消返回 None。
#[tauri::command]
async fn pick_document(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccessState>,
) -> Result<Option<String>, CommandError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| CommandError::new("dialogFailed", e.to_string()))?;
    lock(&state).grant_opened_file(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// 取走 Finder 交来的待打开文件（已授权），取完即清空
#[tauri::command]
fn take_open_requests(requests: State<'_, OpenRequests>) -> Vec<String> {
    requests.take()
}

/// 导出：弹出保存对话框，授权所选目标文件。取消返回 None。
#[tauri::command]
async fn pick_export_target(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccessState>,
    default_name: String,
    default_dir: Option<String>,
) -> Result<Option<String>, CommandError> {
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(default_name)
        .add_filter("HTML", &["html"]);
    if let Some(dir) = default_dir {
        dialog = dialog.set_directory(dir);
    }
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| CommandError::new("dialogFailed", e.to_string()))?;
    lock(&state).grant_export_target(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ── 应用设置持久化（替代前端直接使用 store 插件）──────────────

fn check_persisted_key(key: &str) -> Result<(), CommandError> {
    if PERSISTED_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(CommandError::new("unsupportedSetting", key))
    }
}

#[tauri::command]
fn load_persisted(app: AppHandle, key: String) -> Result<Option<serde_json::Value>, CommandError> {
    check_persisted_key(&key)?;
    let store = app.store(SETTINGS_STORE).map_err(store_error)?;
    Ok(store.get(&key))
}

#[tauri::command]
fn save_persisted(
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), CommandError> {
    check_persisted_key(&key)?;
    let store = app.store(SETTINGS_STORE).map_err(store_error)?;
    store.set(key, value);
    store.save().map_err(store_error)
}

// ── 文档操作（全部先过授权校验）──────────────────────────────

// 扫库 / 读写文件 / 搜索放到线程池上跑：同步命令在主线程执行，大库或网络盘会卡住整个界面
#[tauri::command(async)]
fn list_documents(
    state: State<'_, AccessState>,
    root: String,
) -> Result<Vec<DocumentMeta>, CommandError> {
    let root = to_path(&root);
    lock(&state).check_library_root(&root)?;
    fs_ops::list_documents(&root)
}

#[tauri::command(async)]
fn read_document(
    state: State<'_, AccessState>,
    path: String,
) -> Result<ReadDocumentResult, CommandError> {
    let path = to_path(&path);
    lock(&state).check_document(&path)?;
    fs_ops::read_document(&path)
}

#[tauri::command(async)]
fn write_document(
    state: State<'_, AccessState>,
    path: String,
    content: String,
    expected_mtime: Option<f64>,
) -> Result<WriteResult, CommandError> {
    let target = to_path(&path);
    lock(&state).check_document(&target)?;
    let result = fs_ops::write_document(&target, &content, expected_mtime);
    if result.is_ok() {
        watcher::record_self_write(&target);
    }
    result
}

#[tauri::command]
fn create_document(
    state: State<'_, AccessState>,
    dir: String,
    base_name: String,
) -> Result<DocumentMeta, CommandError> {
    let dir = to_path(&dir);
    lock(&state).check_document_dir(&dir)?;
    fs_ops::create_document(&dir, &base_name)
}

#[tauri::command]
fn rename_document(
    state: State<'_, AccessState>,
    path: String,
    new_name: String,
) -> Result<String, CommandError> {
    let source = to_path(&path);
    let mut access = lock(&state);
    access.check_document(&source)?;
    let new_path = fs_ops::rename_document(&source, &new_name)?;
    access.rename_opened_file(&source, Path::new(&new_path));
    // 自身 rename 产生的 watch 事件不应触发前端刷新/静默重载
    watcher::record_self_write(&source);
    watcher::record_self_write(Path::new(&new_path));
    Ok(new_path)
}

/// 编辑器内联显示图片：原样返回字节（走二进制 IPC，不经 JSON）
#[tauri::command(async)]
fn read_image(
    state: State<'_, AccessState>,
    path: String,
) -> Result<tauri::ipc::Response, CommandError> {
    let target = to_path(&path);
    lock(&state).check_image(&target)?;
    fs_ops::read_image(&target).map(tauri::ipc::Response::new)
}

#[tauri::command]
fn list_folders(state: State<'_, AccessState>, root: String) -> Result<Vec<String>, CommandError> {
    let root = to_path(&root);
    lock(&state).check_library_root(&root)?;
    folders::list_folders(&root)
}

#[tauri::command]
fn create_folder(
    state: State<'_, AccessState>,
    parent: String,
    name: String,
) -> Result<String, CommandError> {
    let parent = to_path(&parent);
    lock(&state).check_library_dir(&parent)?;
    folders::create_folder(&parent, &name)
}

/// 把库里的文档移到库里的另一个文件夹（图片一并复制，见 folders::move_document）
#[tauri::command]
fn move_document(
    state: State<'_, AccessState>,
    path: String,
    target_dir: String,
) -> Result<String, CommandError> {
    let source = to_path(&path);
    let target_dir = to_path(&target_dir);
    let mut access = lock(&state);
    access.check_document(&source)?;
    let source_dir = source
        .parent()
        .ok_or_else(|| CommandError::new("invalidPath", path.clone()))?;
    // 只在库内移动：库外打开的文件不挪进库里
    access.check_library_dir(source_dir)?;
    access.check_library_dir(&target_dir)?;
    let new_path = folders::move_document(&source, &target_dir)?;
    access.rename_opened_file(&source, Path::new(&new_path));
    // 自身移动产生的 watch 事件不应触发「外部删除」提示 / 静默重载
    watcher::record_self_write(&source);
    watcher::record_self_write(Path::new(&new_path));
    Ok(new_path)
}

#[tauri::command]
fn delete_document(state: State<'_, AccessState>, path: String) -> Result<(), CommandError> {
    let path = to_path(&path);
    lock(&state).check_document(&path)?;
    fs_ops::delete_document(&path)
}

#[tauri::command(async)]
fn copy_image_bytes(
    state: State<'_, AccessState>,
    doc_dir: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, CommandError> {
    let doc_dir = to_path(&doc_dir);
    lock(&state).check_document_dir(&doc_dir)?;
    fs_ops::copy_image_bytes(&doc_dir, &file_name, &bytes)
}

/// 扫描全库：标成 async，在后台线程跑，不卡主线程（同步命令在主线程执行）
#[tauri::command(async)]
fn search_content(
    state: State<'_, AccessState>,
    root: String,
    query: String,
) -> Result<Vec<SearchHit>, CommandError> {
    let root = to_path(&root);
    lock(&state).check_library_root(&root)?;
    search::search_content(&root, &query)
}

#[tauri::command(async)]
fn search_tags(
    state: State<'_, AccessState>,
    root: String,
    query: String,
) -> Result<Vec<tags::TagHit>, CommandError> {
    let root = to_path(&root);
    lock(&state).check_library_root(&root)?;
    tags::search_tags(&root, &query)
}

#[tauri::command(async)]
fn list_tags(
    state: State<'_, AccessState>,
    root: String,
) -> Result<Vec<tags::TagCount>, CommandError> {
    let root = to_path(&root);
    lock(&state).check_library_root(&root)?;
    tags::list_tags(&root)
}

/// 写出导出文件：只能写到导出对话框选定的目标
#[tauri::command]
fn write_text_file(
    state: State<'_, AccessState>,
    path: String,
    content: String,
) -> Result<(), CommandError> {
    let path = to_path(&path);
    // 开发期光标居中自检（src/editor/selftest.ts）的结果文件
    #[cfg(debug_assertions)]
    if path == Path::new("/tmp/ink-selftest.txt") {
        return fs_ops::write_text_file(&path, &content);
    }
    lock(&state).check_export_target(&path)?;
    fs_ops::write_text_file(&path, &content)
}

/// 写出新文件（重名自动加序号，不覆盖），返回实际路径
#[tauri::command]
fn write_new_text_file(
    state: State<'_, AccessState>,
    path: String,
    content: String,
) -> Result<String, CommandError> {
    let path = to_path(&path);
    let dir = path
        .parent()
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?;
    lock(&state).check_document_dir(dir)?;
    fs_ops::write_new_text_file(&path, &content)
}

#[tauri::command]
fn copy_assets(
    state: State<'_, AccessState>,
    from_dir: String,
    to_dir: String,
) -> Result<(), CommandError> {
    let (from_dir, to_dir) = (to_path(&from_dir), to_path(&to_dir));
    {
        let access = lock(&state);
        access.check_document_dir(&from_dir)?;
        access.check_export_dir(&to_dir)?;
    }
    fs_ops::copy_assets(&from_dir, &to_dir)
}

#[tauri::command]
fn set_watch_path(
    app: AppHandle,
    state: State<'_, AccessState>,
    path: String,
) -> Result<(), CommandError> {
    let path = to_path(&path);
    lock(&state).check_library_root(&path)?;
    watcher::watch_library(&app, &path)
}

#[tauri::command]
fn home_dir(app: AppHandle) -> Option<String> {
    app.path()
        .home_dir()
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// 在 Finder 中显示文件（替代 shell 插件，权限更小）
///
/// 不做授权校验：只是在访达里选中，不读取内容；⌘Click 图片路径可能指向库外。
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), CommandError> {
    let target = to_path(&path);
    if !target.exists() {
        return Err(CommandError::new("notFound", path));
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg("-R")
        .arg(&target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    #[cfg(not(target_os = "macos"))]
    let status = Command::new("xdg-open")
        .arg(&target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(CommandError::new("revealFailed", s.to_string())),
        Err(e) => Err(CommandError::new("revealFailed", e.to_string())),
    }
}

/// 用系统默认程序打开链接（仅允许 http/https/mailto）
#[tauri::command]
fn open_url(url: String) -> Result<(), CommandError> {
    let lowered = url.trim().to_lowercase();
    if !(lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("mailto:"))
    {
        return Err(CommandError::new("unsupportedUrl", url));
    }
    let status = Command::new("open")
        .arg(&url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(CommandError::new("openUrlFailed", s.to_string())),
        Err(e) => Err(CommandError::new("openUrlFailed", e.to_string())),
    }
}

/// 调起系统打印对话框（macOS = NSPrintOperation，内含「存储为 PDF」）
#[tauri::command]
fn print_current(window: WebviewWindow) -> Result<(), CommandError> {
    window
        .print()
        .map_err(|e| CommandError::new("printFailed", e.to_string()))
}

/// 开始拖动窗口。
///
/// 直接调用运行时 API，绕开 IPC 的 ACL 检查 ——
/// `plugin:window|start_dragging` 不在 `core:window:default` 权限集里，
/// 走 IPC 会被静默拒绝，导致窗口拖不动。
///
/// 与 Tauri 内置实现保持一致：用 `async` 让实际调用发生在事件循环里，
/// 这样 macOS 的 `currentEvent` 仍然是那一次鼠标按下，拖拽才不会丢失起始点。
#[tauri::command]
async fn start_window_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// 最大化 / 还原窗口
#[tauri::command]
async fn toggle_window_maximize(window: WebviewWindow) -> Result<(), String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    let result = if maximized {
        window.unmaximize()
    } else {
        window.maximize()
    };
    result.map_err(|e| e.to_string())
}

/// 供集成测试使用的内部接口
#[doc(hidden)]
pub mod testing {
    use super::*;

    pub fn read_document(path: &std::path::Path) -> Result<fs_ops::ReadDocumentResult, String> {
        fs_ops::read_document(path).map_err(|e| e.to_string())
    }

    pub fn write_document(
        path: &std::path::Path,
        content: &str,
        expected_mtime: Option<f64>,
    ) -> Result<(), String> {
        fs_ops::write_document(path, content, expected_mtime)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn meta_for_testing(path: &std::path::Path) -> fs_ops::DocumentMeta {
        fs_ops::meta_for_testing(path)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AccessState::default())
        .manage(OpenRequests::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            // 主窗口在这里带着主题底色创建（tauri.conf.json 中 create = false），避免冷启动白闪
            window_theme::create_main_window(app)?;

            let handle = app.handle().clone();
            watcher::create_watcher(&handle).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            choose_library,
            change_library,
            pick_document,
            take_open_requests,
            pick_export_target,
            load_persisted,
            save_persisted,
            list_documents,
            read_document,
            write_document,
            create_document,
            rename_document,
            move_document,
            list_folders,
            create_folder,
            delete_document,
            read_image,
            copy_image_bytes,
            search_content,
            search_tags,
            list_tags,
            write_text_file,
            write_new_text_file,
            copy_assets,
            set_watch_path,
            home_dir,
            reveal_in_finder,
            open_url,
            print_current,
            start_window_dragging,
            toggle_window_maximize,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ink")
        .run(|_app, _event| {
            // Finder 双击 / 「打开方式」/ 拖到 Dock 图标（tauri.conf.json 的 fileAssociations）
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect();
                open_requests::enqueue(_app, paths);
            }
        });
}
