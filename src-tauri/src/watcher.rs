//! 文件监听（spec §12.3）
//!
//! 使用 notify（macOS 上走 FSEvents）+ 500ms 去抖，把库目录的外部变更事件推给前端。
//! 应用自身的写入会被记录并过滤，避免自写触发刷新（spec §12.3「自写过滤」）。
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::fs_ops::{mtime_of, CommandError};

/// 事件名：前端 `listen('ink://fs-event', ...)`
pub const FS_EVENT: &str = "ink://fs-event";
/// 监听失败事件
pub const FS_ERROR_EVENT: &str = "ink://fs-error";

/// 自写记录的有效期：超过则不再视为自写
const SELF_WRITE_TTL: Duration = Duration::from_secs(3);

/// 写完之后文件的（mtime, size）；文件已不在（rename 的源路径）时为 None
type Stamp = Option<(f64, u64)>;

struct SelfWrite {
    path: PathBuf,
    stamp: Stamp,
    at: Instant,
}

static RECENT_WRITES: Mutex<Vec<SelfWrite>> = Mutex::new(Vec::new());

fn stamp_of(path: &Path) -> Stamp {
    fs::metadata(path)
        .ok()
        .map(|meta| (mtime_of(&meta), meta.len()))
}

/// 记录一次自身写入（写完 / rename 完之后调用）：连同当时的 mtime 和大小一起记下
pub fn record_self_write(path: &Path) {
    let mut guard = RECENT_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|write| write.at.elapsed() < SELF_WRITE_TTL);
    guard.push(SelfWrite {
        path: path.to_path_buf(),
        stamp: stamp_of(path),
        at: Instant::now(),
    });
}

/// 是否为应用自身产生的写入：不只看路径，还要求文件现在的 mtime / 大小和写完时一致。
/// 否则 Ink 保存后 3 秒内别的程序（同步盘、git、其他编辑器）改了同一个文件，会被当成自写吞掉，
/// 下一次保存就把外部修改覆盖了
fn is_self_write(path: &Path) -> bool {
    let mut guard = RECENT_WRITES.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|write| write.at.elapsed() < SELF_WRITE_TTL);
    let current = stamp_of(path);
    guard
        .iter()
        .any(|write| write.path == path && write.stamp == current)
}

/// 库目录里的隐藏文件 / 目录（保存用的 `.x.md.inktmp`、`.git`、`.DS_Store` …）不触发刷新
fn is_hidden_in(root: Option<&Path>, path: &Path) -> bool {
    let relative = root
        .and_then(|root| path.strip_prefix(root).ok())
        .unwrap_or(path);
    relative
        .components()
        .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
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
                let root = handle.try_state::<WatcherState>().and_then(|state| {
                    state
                        .current
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone()
                });
                for event in events {
                    let path = event.path;
                    if is_hidden_in(root.as_deref(), &path) || is_self_write(&path) {
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
        .map_err(|e| CommandError::new("watchFailed", format!("{} ({})", path.display(), e)))?;

    *state.current.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.to_path_buf());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ink-watcher-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("note.md")
    }

    #[test]
    fn own_write_is_filtered_but_a_later_external_edit_is_not() {
        let path = temp_file("self-write");
        fs::write(&path, "ink").unwrap();
        record_self_write(&path);
        assert!(is_self_write(&path));

        // 3 秒内另一个程序改了同一个文件：必须报给前端
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&path, "someone else").unwrap();
        assert!(!is_self_write(&path));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn renamed_away_source_counts_as_self_write() {
        let path = temp_file("rename");
        record_self_write(&path.with_file_name("gone.md"));
        assert!(is_self_write(&path.with_file_name("gone.md")));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn hidden_paths_are_relative_to_the_library() {
        let root = Path::new("/Users/me/.notes/Ink");
        assert!(!is_hidden_in(Some(root), &root.join("a.md")));
        assert!(is_hidden_in(Some(root), &root.join(".a.md.inktmp")));
        assert!(is_hidden_in(Some(root), &root.join(".git/index")));
        assert!(!is_hidden_in(Some(root), &root.join("sub/b.md")));
    }
}
