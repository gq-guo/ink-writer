//! 文件监听（spec §12.3）
//!
//! 使用 notify（macOS 上走 FSEvents）+ 500ms 去抖，把库目录的外部变更事件推给前端。
//! 应用自身的写入会被记录并过滤，避免自写触发刷新（spec §12.3「自写过滤」）。
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::fs_ops::CommandError;

/// 事件名：前端 `listen('ink://fs-event', ...)`
pub const FS_EVENT: &str = "ink://fs-event";
/// 监听失败事件
pub const FS_ERROR_EVENT: &str = "ink://fs-error";

/// 自写记录的有效期：超过则不再视为自写
const SELF_WRITE_TTL: Duration = Duration::from_secs(3);

static RECENT_WRITES: Mutex<Vec<(PathBuf, Instant)>> = Mutex::new(Vec::new());

/// 记录一次自身写入
pub fn record_self_write(path: &Path) {
    let mut guard = RECENT_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|(_, at)| at.elapsed() < SELF_WRITE_TTL);
    guard.push((path.to_path_buf(), Instant::now()));
}

/// 是否为应用自身产生的写入
fn is_self_write(path: &Path) -> bool {
    let mut guard = RECENT_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|(_, at)| at.elapsed() < SELF_WRITE_TTL);
    guard.iter().any(|(p, _)| p == path)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEvent {
    pub path: String,
    /// create | modify | remove
    pub kind: String,
}

pub struct WatcherState {
    pub debouncer: Mutex<Debouncer<RecommendedWatcher>>,
    pub current: Mutex<Option<PathBuf>>,
}

pub fn create_watcher(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                for event in events {
                    let path = event.path;
                    if is_self_write(&path) {
                        continue;
                    }
                    let kind = if path.exists() { "modify" } else { "remove" };
                    let payload = FsEvent {
                        path: path.to_string_lossy().to_string(),
                        kind: kind.to_string(),
                    };
                    let _ = handle.emit(FS_EVENT, payload);
                }
            }
            Err(err) => {
                let _ = handle.emit(FS_ERROR_EVENT, err.to_string());
            }
        },
    )
    .map_err(|e| e.to_string())?;

    app.manage(WatcherState {
        debouncer: Mutex::new(debouncer),
        current: Mutex::new(None),
    });
    Ok(())
}

/// 切换监听的库目录
pub fn watch_library(app: &AppHandle, path: &Path) -> Result<(), CommandError> {
    let state = app.state::<WatcherState>();
    let mut debouncer = state.debouncer.lock().unwrap_or_else(|e| e.into_inner());

    if let Some(current) = state
        .current
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        if current != path {
            let _ = debouncer.watcher().unwatch(&current);
        }
    }

    debouncer
        .watcher()
        .watch(path, RecursiveMode::Recursive)
        .map_err(|e| CommandError::Message(format!("无法监听文档库：{}", e)))?;

    *state.current.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.to_path_buf());
    Ok(())
}
