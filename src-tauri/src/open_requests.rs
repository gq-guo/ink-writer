//! 从 Finder 打开文档（双击 / 「打开方式」/ 拖到 Dock 图标）
//!
//! macOS 用 `RunEvent::Opened` 把文件交给 App。冷启动时它会早于前端就绪，
//! 所以先放进队列，再发事件通知前端来取；`take_open_requests` 取走即清空，
//! 事件和启动时的主动拉取不会把同一个文件打开两次。
//!
//! 这些路径由系统根据用户在 Finder 里的操作给出，不经过前端，
//! 因此与 ⌘O 选中的文件同等授权（只授权文件本身及其同级目录）。
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::access::{Access, AccessState};

/// 通知前端「有待打开的文件」（不带数据，前端调用 take_open_requests 取）
pub const OPEN_REQUESTED_EVENT: &str = "ink://open-requested";

#[derive(Default)]
pub struct OpenRequests(Mutex<Vec<String>>);

impl OpenRequests {
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }

    fn extend(&self, paths: Vec<String>) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend(paths);
    }
}

/// 授权并返回可打开的文件；目录、不存在的路径、规范化失败的路径一律跳过
pub fn grant_files(access: &mut Access, paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| path.is_file())
        .filter(|path| access.grant_opened_file(path).is_ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

pub fn enqueue(app: &AppHandle, paths: Vec<PathBuf>) {
    let granted = {
        let state = app.state::<AccessState>();
        let mut access = state.0.lock().unwrap_or_else(|e| e.into_inner());
        grant_files(&mut access, paths)
    };
    if granted.is_empty() {
        return;
    }
    app.state::<OpenRequests>().extend(granted);

    // App 已在运行时，窗口可能最小化或在其他桌面
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(OPEN_REQUESTED_EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ink-open-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    #[test]
    fn grants_existing_files_only() {
        let dir = temp_dir("grant");
        let note = dir.join("note.md");
        fs::write(&note, "# hi").unwrap();
        let sub = dir.join("folder");
        fs::create_dir_all(&sub).unwrap();

        let mut access = Access::default();
        let granted = grant_files(
            &mut access,
            vec![note.clone(), sub.clone(), dir.join("missing.md")],
        );

        assert_eq!(granted, vec![note.to_string_lossy().to_string()]);
        assert!(access.check_document(&note).is_ok());
        assert!(access.check_document(&sub.join("x.md")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn take_drains_the_queue() {
        let requests = OpenRequests::default();
        requests.extend(vec!["/a.md".into(), "/b.md".into()]);
        assert_eq!(requests.take(), vec!["/a.md", "/b.md"]);
        assert!(requests.take().is_empty());
    }
}
