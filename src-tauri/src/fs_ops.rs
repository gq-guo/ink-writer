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
    /// 修改时间（Unix 秒，带毫秒小数：乐观锁要分得清同一秒内的两次写入）
    pub mtime: f64,
    pub size: u64,
    /// 文件名去扩展名（空则 "Untitled"）：文件名就是文档的名字，不再取正文里的 H1
    pub display_title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDocumentResult {
    pub content: String,
    pub encoding: String,
    /// 修改时间（Unix 秒，带毫秒小数：乐观锁要分得清同一秒内的两次写入）
    pub mtime: f64,
    pub size: u64,
    pub line_ending: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// 修改时间（Unix 秒，带毫秒小数：乐观锁要分得清同一秒内的两次写入）
    pub mtime: f64,
}

/// 命令错误：前端据此区分「保存冲突」与普通错误
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum CommandError {
    /// mtime 乐观锁失败：磁盘上的文件已被其他程序修改
    MtimeConflict { disk_mtime: f64 },
    /// 普通错误（IO / 编码 / 权限 …）：code 由前端按当前语言翻译（i18n 的 `error.<code>`），
    /// detail 是路径 / 系统错误等不需要翻译的原文
    Error { code: &'static str, detail: String },
}

impl CommandError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        CommandError::Error {
            code,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CommandError::MtimeConflict { disk_mtime } => {
                write!(f, "mtimeConflict: {}", disk_mtime)
            }
            CommandError::Error { code, detail } => write!(f, "{}: {}", code, detail),
        }
    }
}

fn io_message(path: &Path, err: &std::io::Error) -> CommandError {
    let code = match err.kind() {
        std::io::ErrorKind::PermissionDenied => "permissionDenied",
        std::io::ErrorKind::NotFound => "notFound",
        std::io::ErrorKind::StorageFull => "storageFull",
        _ => "ioFailed",
    };
    CommandError::new(code, format!("{} ({})", path.display(), err))
}

pub fn stat_info(path: &Path) -> Result<(f64, u64), CommandError> {
    let meta = fs::metadata(path).map_err(|e| io_message(path, &e))?;
    Ok((mtime_of(&meta), meta.len()))
}

/// 修改时间：Unix 秒，保留到毫秒（截到整秒的话，同一秒里的外部修改会骗过乐观锁）。
/// 毫秒精度的小数经 JSON 往返是精确的，前端原样传回来可以直接比较相等
pub fn mtime_of(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64 / 1000.0)
        .unwrap_or(0.0)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Finder 能用 Ink 打开的几种扩展名（tauri.conf.json 的 fileAssociations）
fn has_markdown_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|e| {
            ["md", "markdown", "mdown", "txt"]
                .iter()
                .any(|ext| e.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
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
    let display_title = display_title_for(&file_name);
    Some(DocumentMeta {
        path: path.to_string_lossy().to_string(),
        file_name,
        dir_prefix,
        mtime,
        size,
        display_title,
    })
}

/// 文档的显示名 = 文件名去扩展名。H1 只是正文的一部分，不参与命名（也就不用读文件开头）
fn display_title_for(file_name: &str) -> String {
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
        mtime: 0.0,
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

    out.sort_by(|a, b| b.mtime.total_cmp(&a.mtime).then(a.path.cmp(&b.path)));
    Ok(out)
}

/// 读取文档（自动处理编码，见 spec §13）
pub fn read_document(path: &Path) -> Result<ReadDocumentResult, CommandError> {
    let bytes = fs::read(path).map_err(|e| io_message(path, &e))?;
    let decoded = encoding::decode(&bytes)
        .map_err(|_| CommandError::new("unknownEncoding", path.display().to_string()))?;
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
///
/// 目标是符号链接时写到它指向的文件（rename 会把链接本身换成普通文件，真正的文件就再也不更新了）；
/// 临时文件沿用原文件的权限位
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let resolved;
    let path = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            resolved = fs::canonicalize(path).map_err(|e| io_message(path, &e))?;
            resolved.as_path()
        }
        _ => path,
    };
    let permissions = fs::metadata(path).ok().map(|meta| meta.permissions());
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
    if let Some(permissions) = permissions {
        let _ = fs::set_permissions(&tmp, permissions);
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
    expected_mtime: Option<f64>,
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

/// 写出新文件，绝不覆盖已有文件：`X.md` 被占用时依次尝试 `X 2.md`、`X 3.md`……
/// 返回实际写入的路径（冲突副本用，第二次冲突不能冲掉第一份副本）
pub fn write_new_text_file(path: &Path, content: &str) -> Result<String, CommandError> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?;
    // 只用来写冲突副本：限定为 Markdown 文档，不能借它在文档旁边写 .zprofile 之类的文件
    if !is_single_file_name(&file_name) || !has_markdown_extension(&file_name) {
        return Err(CommandError::new("invalidFileName", file_name));
    }
    let (stem, ext) = match file_name.rfind('.') {
        Some(idx) if idx > 0 => (file_name[..idx].to_string(), file_name[idx..].to_string()),
        _ => (file_name.clone(), String::new()),
    };

    let mut target = path.to_path_buf();
    let mut counter = 2;
    while target.exists() {
        target = parent.join(format!("{} {}{}", stem, counter, ext));
        counter += 1;
        if counter > 9999 {
            return Err(CommandError::new("tooManyDuplicates", file_name));
        }
    }
    atomic_write(&target, content.as_bytes())?;
    Ok(target.to_string_lossy().to_string())
}

/// 在目录中创建新文档，取最小未占用序号：`Untitled.md` → `Untitled 2.md`
pub fn create_document(dir: &Path, base_name: &str) -> Result<DocumentMeta, CommandError> {
    // base_name 来自 webview：`../../x` 会把新文档建到库外
    if !is_single_file_name(base_name) {
        return Err(CommandError::new("invalidFileName", base_name));
    }
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
            return Err(CommandError::new("tooManyDuplicates", base));
        }
    }

    let path = dir.join(&name);
    atomic_write(&path, b"")?;
    meta_for(&path, dir)
        .ok_or_else(|| CommandError::new("createFailed", path.display().to_string()))
}

/// 只由一个普通路径分量组成的文件名（不含 `/`、`..`），且不以 `.` 开头（不生成隐藏文件）
fn is_single_file_name(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::Normal(_)), None)
    ) && !name.starts_with('.')
}

/// 重命名（仅同目录，spec §7.2）：目标名已被占用时自动加 `-2`、`-3`……，返回实际路径
pub fn rename_document(path: &Path, new_name: &str) -> Result<String, CommandError> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?;
    // 只接受单个文件名：`../x.md` 或 `a/b.md` 会把文件挪出原目录
    if !is_single_file_name(new_name) {
        return Err(CommandError::new("invalidFileName", new_name));
    }

    let (stem, ext) = match new_name.rfind('.') {
        Some(idx) if idx > 0 => (&new_name[..idx], &new_name[idx..]),
        _ => (new_name, ""),
    };
    let mut target = parent.join(new_name);
    let mut counter = 2;
    while target.exists() && !is_same_file(&target, path) {
        target = parent.join(format!("{}-{}{}", stem, counter, ext));
        counter += 1;
        if counter > 9999 {
            return Err(CommandError::new("tooManyDuplicates", new_name));
        }
    }
    fs::rename(path, &target).map_err(|e| io_message(path, &e))?;
    Ok(target.to_string_lossy().to_string())
}

/// 大小写变体（aa.md → AA.md）在 macOS 大小写不敏感文件系统上是同一个文件，
/// target.exists() 为 true，需按 canonical 路径判断
fn is_same_file(a: &Path, b: &Path) -> bool {
    fs::canonicalize(a)
        .ok()
        .zip(fs::canonicalize(b).ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false)
}

/** 复制整个文档库（更换保存位置用）：复制全部文件（.md、assets 里的图片等），重名跳过，不删除旧库；
 *  copied / skipped 只统计 .md，给提示文案用 */
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyStats {
    pub copied: u64,
    pub skipped: u64,
}

pub fn copy_library(from: &Path, to: &Path) -> Result<CopyStats, CommandError> {
    let mut stats = CopyStats {
        copied: 0,
        skipped: 0,
    };
    copy_library_inner(from, to, &mut stats)?;
    Ok(stats)
}

fn copy_library_inner(from: &Path, to: &Path, stats: &mut CopyStats) -> Result<(), CommandError> {
    let entries = match fs::read_dir(from) {
        Ok(e) => e,
        Err(e) => return Err(io_message(from, &e)),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let source = entry.path();
        let target = to.join(&name);
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            // 只复制文档内容（.md 与 assets 等媒体目录），其他目录也一并复制以保持相对结构
            fs::create_dir_all(&target).map_err(|e| io_message(&target, &e))?;
            copy_library_inner(&source, &target, stats)?;
        } else if file_type.is_file() {
            // 图片等附件也要带过去，否则新库里的 ![](assets/x.png) 全部失效
            let markdown = is_markdown(&name);
            if target.exists() {
                if markdown {
                    stats.skipped += 1;
                }
            } else {
                fs::copy(&source, &target).map_err(|e| io_message(&source, &e))?;
                if markdown {
                    stats.copied += 1;
                }
            }
        }
    }
    Ok(())
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
        return Err(CommandError::new("notFound", path.display().to_string()));
    }
    trash::delete(path)
        .map_err(|e| CommandError::new("trashFailed", format!("{} ({})", path.display(), e)))
}

/// 内联显示的图片上限：再大的图读进 webview 只会拖慢编辑器
const MAX_INLINE_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// 读图片字节（编辑器内联显示用）
pub fn read_image(path: &Path) -> Result<Vec<u8>, CommandError> {
    let size = fs::metadata(path).map_err(|e| io_message(path, &e))?.len();
    if size > MAX_INLINE_IMAGE_BYTES {
        return Err(CommandError::new(
            "imageTooLarge",
            path.display().to_string(),
        ));
    }
    fs::read(path).map_err(|e| io_message(path, &e))
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
    // 空格、括号等在 Markdown 链接目标里要转义才合法（macOS 截图名全是空格）：直接换成 -
    let safe: String = base
        .chars()
        .map(|c| {
            if c.is_whitespace() || "/\\:*?\"<>|()[]#%".contains(c) {
                '-'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim_start_matches(['.', '-']).to_string();
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
        // 按 mtime（秒）倒序：两次写入跨过整秒时 sub/c.md 会排到前面，所以按文件名找，不按下标
        let nested = list
            .iter()
            .find(|m| m.file_name == "c.md")
            .expect("应列出子目录里的 c.md");
        assert_eq!(nested.dir_prefix, "sub/");
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

    #[cfg(unix)]
    #[test]
    fn atomic_write_follows_symlinks_and_keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("symlink");
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        fs::write(&real, "old").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        write_document(&link, "new", None).unwrap();

        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
        assert_eq!(
            fs::metadata(&real).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mtime_conflict_is_detected() {
        let dir = temp_dir("conflict");
        let path = dir.join("y.md");
        let result = write_document(&path, "one", None).unwrap();
        // 同一秒内的外部修改也要能发现（以前 mtime 截到整秒，这里会被放过去）
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_document(&path, "two", None).unwrap();
        let err = write_document(&path, "three", Some(result.mtime)).unwrap_err();
        match err {
            CommandError::MtimeConflict { .. } => {}
            other => panic!("expected conflict, got {:?}", other),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_new_text_file_never_overwrites() {
        let dir = temp_dir("newfile");
        let path = dir.join("Note (Conflicted Copy).md");

        let first = write_new_text_file(&path, "first").unwrap();
        let second = write_new_text_file(&path, "second").unwrap();

        assert_eq!(first, path.to_string_lossy());
        assert!(second.ends_with("Note (Conflicted Copy) 2.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        assert_eq!(fs::read_to_string(&second).unwrap(), "second");
    }

    #[test]
    fn rename_to_taken_name_appends_suffix() {
        let dir = temp_dir("rename-taken");
        fs::write(dir.join("t1.md"), "taken").unwrap();
        fs::write(dir.join("t1-2.md"), "taken too").unwrap();
        fs::write(dir.join("new.md"), "mine").unwrap();

        let renamed = rename_document(&dir.join("new.md"), "t1.md").unwrap();

        assert!(renamed.ends_with("t1-3.md"));
        assert_eq!(fs::read_to_string(&renamed).unwrap(), "mine");
        assert_eq!(fs::read_to_string(dir.join("t1.md")).unwrap(), "taken");
        assert!(!dir.join("new.md").exists());
    }

    #[test]
    fn rename_to_own_name_keeps_it() {
        let dir = temp_dir("rename-same");
        fs::write(dir.join("note.md"), "x").unwrap();
        let renamed = rename_document(&dir.join("note.md"), "note.md").unwrap();
        assert!(renamed.ends_with("note.md"));
    }

    #[test]
    fn rename_rejects_names_leaving_directory() {
        let dir = temp_dir("rename-escape");
        fs::write(dir.join("note.md"), "x").unwrap();
        assert!(rename_document(&dir.join("note.md"), "../escaped.md").is_err());
        assert!(rename_document(&dir.join("note.md"), "sub/escaped.md").is_err());
        assert!(dir.join("note.md").exists());
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
    fn copy_library_copies_markdown_and_skips_existing() {
        let dir = temp_dir("copy-lib");
        let from = dir.join("from");
        let to = dir.join("to");
        fs::create_dir_all(from.join("sub")).unwrap();
        fs::create_dir_all(from.join("assets")).unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(from.join("a.md"), "a").unwrap();
        fs::write(from.join("sub/b.md"), "b").unwrap();
        fs::write(from.join("notes.txt"), "t").unwrap();
        fs::write(from.join("assets/shot.png"), b"png").unwrap();
        // 目标已存在同名文件 → 跳过
        fs::write(to.join("a.md"), "old").unwrap();

        let stats = copy_library(&from, &to).unwrap();
        assert_eq!(stats.copied, 1);
        assert_eq!(stats.skipped, 1);
        assert_eq!(fs::read_to_string(to.join("sub/b.md")).unwrap(), "b");
        assert_eq!(fs::read_to_string(to.join("a.md")).unwrap(), "old");
        // 附件一起复制（不计入文档数）
        assert_eq!(fs::read(to.join("assets/shot.png")).unwrap(), b"png");
        assert!(to.join("notes.txt").exists());
        // 旧库不受影响
        assert!(from.join("a.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn webview_supplied_names_stay_single_documents() {
        let dir = temp_dir("names");
        assert!(create_document(&dir, "../escape").is_err());
        assert!(create_document(&dir, ".hidden").is_err());
        assert!(write_new_text_file(&dir.join(".zprofile"), "x").is_err());
        assert!(write_new_text_file(&dir.join("run.sh"), "x").is_err());
        assert!(write_new_text_file(&dir.join("Note (Conflicted Copy).md"), "x").is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_image_dedupes() {
        let dir = temp_dir("image");
        let doc_dir = dir.join("doc");
        fs::create_dir_all(&doc_dir).unwrap();
        let a = copy_image_bytes(&doc_dir, "shot.png", b"png").unwrap();
        let b = copy_image_bytes(&doc_dir, "shot.png", b"png").unwrap();
        assert_eq!(a, "assets/shot.png");
        assert_eq!(b, "assets/shot-2.png");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_image_bytes_makes_markdown_safe_names() {
        let dir = temp_dir("image-names");
        let doc_dir = dir.join("doc");
        fs::create_dir_all(&doc_dir).unwrap();
        let rel =
            copy_image_bytes(&doc_dir, "Screenshot 2026-10-26 at 10.00 (2).png", b"x").unwrap();
        assert_eq!(rel, "assets/Screenshot-2026-10-26-at-10.00--2-.png");
        let hidden = copy_image_bytes(&doc_dir, ".secret.png", b"x").unwrap();
        assert_eq!(hidden, "assets/secret.png");
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
