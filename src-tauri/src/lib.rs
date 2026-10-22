//! Ink —— 极简 Markdown 写作软件（Tauri 2 后端）
//!
//! 设计要点：
//! - 所有文件写入走「临时文件 + fsync + rename」的原子写，并带 mtime 乐观锁
//! - 库目录可自定义，监听随之切换
//! - 编码永远以 UTF-8 写出，读取时兼容 GBK
mod encoding;
mod fs_ops;
mod search;
mod watcher;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::{Manager, WebviewWindow};

use fs_ops::{CommandError, DocumentMeta, ReadDocumentResult, WriteResult};
use search::SearchHit;

fn to_path(path: &str) -> PathBuf {
    PathBuf::from(path)
}

#[tauri::command]
fn list_documents(root: String) -> Result<Vec<DocumentMeta>, CommandError> {
    fs_ops::list_documents(&to_path(&root))
}

#[tauri::command]
fn read_document(path: String) -> Result<ReadDocumentResult, CommandError> {
    fs_ops::read_document(&to_path(&path))
}

#[tauri::command]
fn write_document(
    path: String,
    content: String,
    expected_mtime: Option<i64>,
) -> Result<WriteResult, CommandError> {
    let target = to_path(&path);
    let result = fs_ops::write_document(&target, &content, expected_mtime);
    if result.is_ok() {
        watcher::record_self_write(&target);
    }
    result
}

#[tauri::command]
fn create_document(dir: String, base_name: String) -> Result<DocumentMeta, CommandError> {
    fs_ops::create_document(&to_path(&dir), &base_name)
}

#[tauri::command]
fn rename_document(path: String, new_name: String) -> Result<String, CommandError> {
    let source = to_path(&path);
    let new_path = fs_ops::rename_document(&source, &new_name)?;
    // 自身 rename 产生的 watch 事件不应触发前端刷新/静默重载
    watcher::record_self_write(&source);
    watcher::record_self_write(Path::new(&new_path));
    Ok(new_path)
}

#[tauri::command]
fn delete_document(path: String) -> Result<(), CommandError> {
    fs_ops::delete_document(&to_path(&path))
}

#[tauri::command]
fn copy_image(doc_dir: String, source_path: String) -> Result<String, CommandError> {
    fs_ops::copy_image(&to_path(&doc_dir), &to_path(&source_path))
}

#[tauri::command]
fn copy_image_bytes(
    doc_dir: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, CommandError> {
    fs_ops::copy_image_bytes(&to_path(&doc_dir), &file_name, &bytes)
}

#[tauri::command]
fn search_content(root: String, query: String) -> Result<Vec<SearchHit>, CommandError> {
    search::search_content(&to_path(&root), &query)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), CommandError> {
    fs_ops::write_text_file(&to_path(&path), &content)
}

#[tauri::command]
fn copy_assets(from_dir: String, to_dir: String) -> Result<(), CommandError> {
    fs_ops::copy_assets(&to_path(&from_dir), &to_path(&to_dir))
}

/// 更换文档库：复制现有文档到目标目录（不删除旧库）
#[tauri::command]
fn copy_library(from_dir: String, to_dir: String) -> Result<fs_ops::CopyStats, CommandError> {
    fs_ops::copy_library(&to_path(&from_dir), &to_path(&to_dir))
}

#[tauri::command]
fn set_watch_path(app: tauri::AppHandle, path: String) -> Result<(), CommandError> {
    watcher::watch_library(&app, Path::new(&path))
}

/// 路径是否存在
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 创建目录（含父目录）
#[tauri::command]
fn ensure_directory(path: String) -> Result<(), CommandError> {
    std::fs::create_dir_all(&path)
        .map_err(|e| CommandError::Message(format!("无法创建目录 {}：{}", path, e)))
}

#[tauri::command]
fn home_dir(app: tauri::AppHandle) -> Option<String> {
    app.path()
        .home_dir()
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// 在 Finder 中显示文件（替代 shell 插件，权限更小）
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), CommandError> {
    let target = to_path(&path);
    if !target.exists() {
        return Err(CommandError::Message(format!("文件不存在：{}", path)));
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
        Ok(s) => Err(CommandError::Message(format!(
            "无法在访达中显示（退出码 {}）",
            s
        ))),
        Err(e) => Err(CommandError::Message(format!("无法在访达中显示：{}", e))),
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
        return Err(CommandError::Message(
            "仅支持打开 http/https/mailto 链接".into(),
        ));
    }
    let status = Command::new("open")
        .arg(&url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(CommandError::Message(format!(
            "无法打开链接（退出码 {}）",
            s
        ))),
        Err(e) => Err(CommandError::Message(format!("无法打开链接：{}", e))),
    }
}

/// 调起系统打印对话框（macOS = NSPrintOperation，内含「存储为 PDF」）
#[tauri::command]
fn print_current(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
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
        fs_ops::read_document(path).map_err(|e| match e {
            fs_ops::CommandError::Message(m) => m,
            other => format!("{:?}", other),
        })
    }

    pub fn write_document(
        path: &std::path::Path,
        content: &str,
        expected_mtime: Option<i64>,
    ) -> Result<(), String> {
        fs_ops::write_document(path, content, expected_mtime)
            .map(|_| ())
            .map_err(|e| match e {
                fs_ops::CommandError::Message(m) => m,
                other => format!("{:?}", other),
            })
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
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let handle = app.handle().clone();
            watcher::create_watcher(&handle).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_documents,
            read_document,
            write_document,
            create_document,
            rename_document,
            delete_document,
            copy_image,
            copy_image_bytes,
            search_content,
            write_text_file,
            copy_assets,
            copy_library,
            set_watch_path,
            path_exists,
            ensure_directory,
            home_dir,
            reveal_in_finder,
            open_url,
            print_current,
            start_window_dragging,
            toggle_window_maximize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ink");
}
