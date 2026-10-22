//! 文件系统操作（spec §7）
//!
//! 所有写入均为「临时文件 + fsync + rename」的原子写，避免崩溃产生半写文件。
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::encoding;

/// 只索引 .md（spec §7.2）
pub const MARKDOWN_EXT: &str = "md";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub path: String,
    pub file_name: String,
    pub dir_prefix: String,
    pub mtime: i64,
    pub size: u64,
    /// 首个 H1 ?? 文件名去扩展名 ?? "Untitled"（spec §7.3）
    pub display_title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDocumentResult {
    pub content: String,
    pub encoding: String,
    pub mtime: i64,
    pub size: u64,
    pub line_ending: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub mtime: i64,
}

/// 命令错误：前端据此区分「保存冲突」与普通错误
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum CommandError {
    /// mtime 乐观锁失败：磁盘上的文件已被其他程序修改
    MtimeConflict { disk_mtime: i64 },
    /// 普通错误（IO / 编码 / 权限 …）
    Message(String),
}

impl From<String> for CommandError {
    fn from(value: String) -> Self {
        CommandError::Message(value)
    }
}

impl From<&str> for CommandError {
    fn from(value: &str) -> Self {
        CommandError::Message(value.to_string())
    }
}

fn io_message(path: &Path, err: &std::io::Error) -> CommandError {
    let kind = match err.kind() {
        std::io::ErrorKind::PermissionDenied => "权限被拒绝",
        std::io::ErrorKind::NotFound => "文件不存在",
        std::io::ErrorKind::StorageFull => "磁盘空间不足",
        _ => "操作失败",
    };
    CommandError::Message(format!("{}：{}（{}）", kind, path.display(), err))
}

pub fn stat_info(path: &Path) -> Result<(i64, u64), CommandError> {
    let meta = fs::metadata(path).map_err(|e| io_message(path, &e))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok((mtime, meta.len()))
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|e| e.eq_ignore_ascii_case(MARKDOWN_EXT))
        .unwrap_or(false)
}

fn meta_for(path: &Path, root: &Path) -> Option<DocumentMeta> {
    let (mtime, size) = stat_info(path).ok()?;
    let file_name = path.file_name()?.to_string_lossy().to_string();
    let dir_prefix = path
        .parent()
        .and_then(|p| p.strip_prefix(root).ok())
        .map(|rel| {
            let s = rel.to_string_lossy().to_string();
            if s.is_empty() {
                String::new()
            } else {
                format!("{}/", s)
            }
        })
        .unwrap_or_default();
    let display_title = read_display_title(path, &file_name);
    Some(DocumentMeta {
        path: path.to_string_lossy().to_string(),
        file_name,
        dir_prefix,
        mtime,
        size,
        display_title,
    })
}

/// 读取文件开头的首个 H1 作为显示标题（spec §7.3）
fn read_display_title(path: &Path, file_name: &str) -> String {
    use std::io::Read;
    if let Ok(mut file) = fs::File::open(path) {
        let mut buffer = vec![0u8; 4096];
        if let Ok(count) = file.read(&mut buffer) {
            buffer.truncate(count);
            if let Ok(decoded) = encoding::decode(&buffer) {
                for line in decoded.text.lines() {
                    if let Some(rest) = line.strip_prefix("# ") {
                        let title = rest.trim().trim_end_matches('#').trim();
                        if !title.is_empty() {
                            return title.chars().take(80).collect();
                        }
                    }
                }
            }
        }
    }
    let stem = match file_name.rfind('.') {
        Some(index) if index > 0 => &file_name[..index],
        _ => file_name,
    };
    if stem.is_empty() {
        "Untitled".to_string()
    } else {
        stem.to_string()
    }
}

/// 供集成测试使用：获取单个文件的元数据
pub fn meta_for_testing(path: &Path) -> DocumentMeta {
    meta_for(path, path.parent().unwrap_or(Path::new("/"))).unwrap_or(DocumentMeta {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        dir_prefix: String::new(),
        mtime: 0,
        size: 0,
        display_title: String::new(),
    })
}

/// 扫描库目录，返回所有 .md 文档（按 mtime 倒序）
pub fn list_documents(root: &Path) -> Result<Vec<DocumentMeta>, CommandError> {
    if !root.exists() {
        fs::create_dir_all(root).map_err(|e| io_message(root, &e))?;
    }
    let mut out: Vec<DocumentMeta> = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                // 单个目录不可读不应阻断整个列表
                if dir == root {
                    return Err(io_message(&dir, &e));
                }
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if !is_hidden(&name) {
                    stack.push(path);
                }
                continue;
            }
            if is_hidden(&name) || !is_markdown(&name) {
                continue;
            }
            if let Some(meta) = meta_for(&path, root) {
                out.push(meta);
            }
        }
    }

    out.sort_by(|a, b| b.mtime.cmp(&a.mtime).then(a.path.cmp(&b.path)));
    Ok(out)
}

/// 读取文档（自动处理编码，见 spec §13）
pub fn read_document(path: &Path) -> Result<ReadDocumentResult, CommandError> {
    let bytes = fs::read(path).map_err(|e| io_message(path, &e))?;
    let decoded = encoding::decode(&bytes).map_err(CommandError::Message)?;
    let line_ending = encoding::detect_line_ending(&decoded.text).to_string();
    let content = encoding::normalize_to_lf(&decoded.text);
    let (mtime, size) = stat_info(path)?;
    Ok(ReadDocumentResult {
        content,
        encoding: decoded.kind.as_str().to_string(),
        mtime,
        size,
        line_ending,
    })
}

/// 原子写：写临时文件 → fsync → rename
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| io_message(parent, &e))?;
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.md".to_string());
    let tmp: PathBuf = path.with_file_name(format!(".{}.inktmp", file_name));

    {
        let mut file = fs::File::create(&tmp).map_err(|e| io_message(&tmp, &e))?;
        file.write_all(bytes).map_err(|e| io_message(&tmp, &e))?;
        file.sync_all().map_err(|e| io_message(&tmp, &e))?;
    }

    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_message(path, &e)
    })?;

    // 同步目录项，保证 rename 落盘
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

/// 写入文档，带 mtime 乐观锁（spec §12.2）
pub fn write_document(
    path: &Path,
    content: &str,
    expected_mtime: Option<i64>,
) -> Result<WriteResult, CommandError> {
    if let Some(expected) = expected_mtime {
        if let Ok((current, _)) = stat_info(path) {
            if current != expected {
                return Err(CommandError::MtimeConflict {
                    disk_mtime: current,
                });
            }
        }
    }

    // 行尾风格：已有文件保持原风格，新文件用 LF
    let style = fs::read(path)
        .ok()
        .map(|b| encoding::detect_line_ending(&String::from_utf8_lossy(&b)).to_string())
        .unwrap_or_else(|| "lf".to_string());
    let payload = encoding::apply_line_ending(&encoding::normalize_to_lf(content), &style);

    atomic_write(path, payload.as_bytes())?;
    let (mtime, _) = stat_info(path)?;
    Ok(WriteResult { mtime })
}

/// 写出任意文本文件（导出用），UTF-8 无 BOM
pub fn write_text_file(path: &Path, content: &str) -> Result<(), CommandError> {
    atomic_write(path, content.as_bytes())
}

/// 在目录中创建新文档，取最小未占用序号：`Untitled.md` → `Untitled 2.md`
pub fn create_document(dir: &Path, base_name: &str) -> Result<DocumentMeta, CommandError> {
    fs::create_dir_all(dir).map_err(|e| io_message(dir, &e))?;

    let taken: Vec<String> = fs::read_dir(dir)
        .map_err(|e| io_message(dir, &e))?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    let base = base_name.trim();
    let base = if base.is_empty() { "Untitled" } else { base };
    let mut name = format!("{}.{}", base, MARKDOWN_EXT);
    let mut counter = 2;
    while taken.iter().any(|t| t.eq_ignore_ascii_case(&name)) {
        name = format!("{} {}.{}", base, counter, MARKDOWN_EXT);
        counter += 1;
        if counter > 9999 {
            return Err(CommandError::Message(
                "目录中文件过多，无法创建新文档".into(),
            ));
        }
    }

    let path = dir.join(&name);
    atomic_write(&path, b"")?;
    meta_for(&path, dir).ok_or_else(|| CommandError::Message("创建文档失败".into()))
}

/// 重命名（仅同目录）
pub fn rename_document(path: &Path, new_name: &str) -> Result<String, CommandError> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::Message("无效的文件路径".into()))?;
    let target = parent.join(new_name);
    // 大小写变体（aa.md → AA.md）在同一文件上，macOS 大小写不敏感文件系统
    // 下 target.exists() 为 true，需按 canonical 路径判断是否同一文件
    let same_file = fs::canonicalize(&target)
        .ok()
        .zip(fs::canonicalize(path).ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false);
    if !same_file && target.exists() {
        return Err(CommandError::Message(format!(
            "已存在同名文件：{}",
            new_name
        )));
    }
    fs::rename(path, &target).map_err(|e| io_message(path, &e))?;
    Ok(target.to_string_lossy().to_string())
}

/// 复制 assets 目录（导出 HTML 时使用）
pub fn copy_assets(from_dir: &Path, to_dir: &Path) -> Result<(), CommandError> {
    let source = from_dir.join("assets");
    if !source.is_dir() {
        return Ok(());
    }
    let target = to_dir.join("assets");
    copy_dir(&source, &target)?;
    Ok(())
}

fn copy_dir(source: &Path, target: &Path) -> Result<(), CommandError> {
    fs::create_dir_all(target).map_err(|e| io_message(target, &e))?;
    let entries = fs::read_dir(source).map_err(|e| io_message(source, &e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let destination = target.join(&name);
        let file_type = entry.file_type().map_err(|e| io_message(&path, &e))?;
        if file_type.is_dir() {
            copy_dir(&path, &destination)?;
        } else if file_type.is_file() {
            fs::copy(&path, &destination).map_err(|e| io_message(&path, &e))?;
        }
    }
    Ok(())
}

/// 移入系统废纸篓（不做应用内硬删除）
pub fn delete_document(path: &Path) -> Result<(), CommandError> {
    if !path.exists() {
        return Err(CommandError::Message("文件已不存在".into()));
    }
    trash::delete(path).map_err(|e| CommandError::Message(format!("移入废纸篓失败：{}", e)))
}

/// 复制图片到文档同级的 assets/，重名追加 -2/-3，返回相对路径
pub fn copy_image(doc_dir: &Path, source: &Path) -> Result<String, CommandError> {
    let assets = doc_dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| io_message(&assets, &e))?;

    let original = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "image.png".into());

    let name = unique_asset_name(&assets, &original);
    fs::copy(source, assets.join(&name)).map_err(|e| io_message(source, &e))?;
    Ok(format!("assets/{}", name))
}

/// 写入图片字节（拖拽 / 粘贴），重名追加 -2/-3，返回相对路径
pub fn copy_image_bytes(
    doc_dir: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<String, CommandError> {
    let assets = doc_dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| io_message(&assets, &e))?;

    let base = Path::new(file_name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "image.png".into());
    let safe: String = base
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let safe = if safe.is_empty() {
        "image.png".to_string()
    } else {
        safe
    };

    let name = unique_asset_name(&assets, &safe);
    fs::write(assets.join(&name), bytes).map_err(|e| io_message(&assets, &e))?;
    Ok(format!("assets/{}", name))
}

/// 重名追加 -2 / -3
fn unique_asset_name(assets: &Path, original: &str) -> String {
    let (stem, ext) = match original.rfind('.') {
        Some(idx) if idx > 0 => (original[..idx].to_string(), original[idx..].to_string()),
        _ => (original.to_string(), String::new()),
    };

    let mut name = original.to_string();
    let mut counter = 2;
    while assets.join(&name).exists() {
        name = format!("{}-{}{}", stem, counter, ext);
        counter += 1;
        if counter > 9999 {
            return format!("{}-{}{}", stem, std::process::id(), ext);
        }
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("ink-test-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_markdown_only_and_sorted() {
        let dir = temp_dir("list");
        fs::write(dir.join("a.md"), "a").unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/c.md"), "c").unwrap();
        let list = list_documents(&dir).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|m| m.file_name.ends_with(".md")));
        assert_eq!(list[1].dir_prefix, "sub/");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = temp_dir("write");
        let path = dir.join("x.md");
        write_document(&path, "hello", None).unwrap();
        let read = read_document(&path).unwrap();
        assert_eq!(read.content, "hello");
        // 没有残留临时文件
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("inktmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mtime_conflict_is_detected() {
        let dir = temp_dir("conflict");
        let path = dir.join("y.md");
        let result = write_document(&path, "one", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        write_document(&path, "two", None).unwrap();
        let err = write_document(&path, "three", Some(result.mtime)).unwrap_err();
        match err {
            CommandError::MtimeConflict { .. } => {}
            other => panic!("expected conflict, got {:?}", other),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_document_picks_free_sequence() {
        let dir = temp_dir("create");
        let first = create_document(&dir, "Untitled").unwrap();
        assert_eq!(first.file_name, "Untitled.md");
        let second = create_document(&dir, "Untitled").unwrap();
        assert_eq!(second.file_name, "Untitled 2.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_image_dedupes() {
        let dir = temp_dir("image");
        let src = dir.join("shot.png");
        fs::write(&src, b"png").unwrap();
        let doc_dir = dir.join("doc");
        fs::create_dir_all(&doc_dir).unwrap();
        let a = copy_image(&doc_dir, &src).unwrap();
        let b = copy_image(&doc_dir, &src).unwrap();
        assert_eq!(a, "assets/shot.png");
        assert_eq!(b, "assets/shot-2.png");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_image_bytes_writes_file() {
        let dir = temp_dir("image-bytes");
        let doc_dir = dir.join("doc");
        fs::create_dir_all(&doc_dir).unwrap();
        let rel = copy_image_bytes(&doc_dir, "a b/c.png", b"data").unwrap();
        assert_eq!(rel, "assets/c.png");
        let written = fs::read(doc_dir.join("assets").join("c.png")).unwrap();
        assert_eq!(written, b"data");
        let _ = fs::remove_dir_all(&dir);
    }
}
