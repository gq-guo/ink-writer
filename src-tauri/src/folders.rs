//! 文件夹：列出、新建，把文档移到别的文件夹
//!
//! 文件夹就是库目录下的普通子目录。侧栏只列「有文档（任意层级）」或「完全空（刚建的）」的目录，
//! 隐藏目录与只放图片的 assets/ 之类不出现。
use std::fs;
use std::path::{Component, Path, PathBuf};

use pulldown_cmark::{Event, Parser, Tag};

use crate::encoding;
use crate::fs_ops::{
    io_message, is_hidden, is_markdown, is_same_file, is_single_file_name, CommandError,
};

/// 库里的文件夹，dirPrefix 格式（"Project/"、"Project/Drafts/"），按路径排序
pub fn list_folders(root: &Path) -> Result<Vec<String>, CommandError> {
    let mut out = Vec::new();
    visit(root, root, &mut out).map_err(|e| io_message(root, &e))?;
    out.sort();
    Ok(out)
}

/// 返回 dir 里是否有文档（任意层级）；把该列出的子目录放进 out
fn visit(root: &Path, dir: &Path, out: &mut Vec<String>) -> std::io::Result<bool> {
    let mut has_document = false;
    for entry in fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if is_hidden(&name) || file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let path = entry.path();
            // 子目录读不了不影响别的目录
            let child_has_document = visit(root, &path, out).unwrap_or(false);
            let empty = fs::read_dir(&path)
                .map(|mut it| it.next().is_none())
                .unwrap_or(false);
            if child_has_document || empty {
                if let Ok(relative) = path.strip_prefix(root) {
                    out.push(format!("{}/", relative.to_string_lossy()));
                }
            }
            has_document |= child_has_document;
        } else if is_markdown(&name) {
            has_document = true;
        }
    }
    Ok(has_document)
}

/// 在 parent 下新建文件夹；name 只能是单个名字（不含 `/`、`..`，不以 `.` 开头）
pub fn create_folder(parent: &Path, name: &str) -> Result<String, CommandError> {
    let name = name.trim();
    if name.is_empty() || !is_single_file_name(name) {
        return Err(CommandError::new("invalidFolderName", name));
    }
    let target = parent.join(name);
    if target.exists() {
        return Err(CommandError::new("folderExists", name));
    }
    fs::create_dir(&target).map_err(|e| io_message(&target, &e))?;
    Ok(target.to_string_lossy().to_string())
}

/// 把文档移到 target_dir（保留文件名，重名时加 `-2`、`-3`……），返回新路径。
///
/// 文档里用相对路径引用的图片（`![](assets/a.png)`）一并复制过去，移动后图片不会断：
/// 只复制，不删原图（别的文档可能也在用）；目标已有同名文件时不覆盖
pub fn move_document(path: &Path, target_dir: &Path) -> Result<String, CommandError> {
    let source_dir = path
        .parent()
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?;
    if !target_dir.is_dir() {
        return Err(CommandError::new(
            "notFound",
            target_dir.display().to_string(),
        ));
    }
    if is_same_file(source_dir, target_dir) {
        return Ok(path.to_string_lossy().to_string());
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?
        .to_string_lossy()
        .to_string();
    let (stem, ext) = match file_name.rfind('.') {
        Some(idx) if idx > 0 => (&file_name[..idx], &file_name[idx..]),
        _ => (file_name.as_str(), ""),
    };
    let mut target = target_dir.join(&file_name);
    let mut counter = 2;
    while target.exists() {
        target = target_dir.join(format!("{}-{}{}", stem, counter, ext));
        counter += 1;
        if counter > 9999 {
            return Err(CommandError::new("tooManyDuplicates", file_name));
        }
    }

    let images = fs::read(path)
        .ok()
        .and_then(|bytes| encoding::decode(&bytes).ok())
        .map(|decoded| relative_images(&decoded.text))
        .unwrap_or_default();
    fs::rename(path, &target).map_err(|e| io_message(path, &e))?;
    for image in images {
        copy_image(source_dir, target_dir, &image);
    }
    Ok(target.to_string_lossy().to_string())
}

/// 文档里引用的本地图片的相对路径：不含协议、不以 `/` 开头、不含 `..`（不会指到文档目录外面）
fn relative_images(text: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for event in Parser::new(text) {
        let Event::Start(Tag::Image { dest_url, .. }) = event else {
            continue;
        };
        if dest_url.contains("://") || dest_url.starts_with("data:") {
            continue;
        }
        let relative = PathBuf::from(dest_url.as_ref());
        let safe = relative.components().count() > 0
            && relative
                .components()
                .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        if safe && !out.contains(&relative) {
            out.push(relative);
        }
    }
    out
}

/// 复制一张图到新目录的同一相对位置；源不是普通文件（不存在、目录、符号链接）或目标已存在时跳过
fn copy_image(source_dir: &Path, target_dir: &Path, relative: &Path) {
    let from = source_dir.join(relative);
    let to = target_dir.join(relative);
    let is_plain_file = fs::symlink_metadata(&from)
        .map(|m| m.is_file())
        .unwrap_or(false);
    if !is_plain_file || to.exists() {
        return;
    }
    if let Some(parent) = to.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let _ = fs::copy(&from, &to);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_of(error: CommandError) -> &'static str {
        match error {
            CommandError::Error { code, .. } => code,
            CommandError::MtimeConflict { .. } => "mtimeConflict",
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ink-folders-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_folders_with_documents_or_empty_ones() {
        let root = temp_dir("list");
        fs::create_dir_all(root.join("Work/2026")).unwrap();
        fs::write(root.join("Work/2026/a.md"), "a").unwrap();
        fs::create_dir_all(root.join("Empty")).unwrap();
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets/x.png"), "png").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        assert_eq!(
            list_folders(&root).unwrap(),
            vec!["Empty/", "Work/", "Work/2026/"]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn creates_folder_and_rejects_bad_names() {
        let root = temp_dir("create");
        let made = create_folder(&root, " 读书 ").unwrap();
        assert!(Path::new(&made).is_dir());
        assert_eq!(
            code_of(create_folder(&root, "读书").unwrap_err()),
            "folderExists"
        );
        for bad in ["", "a/b", "..", ".hidden", "../out"] {
            assert_eq!(
                code_of(create_folder(&root, bad).unwrap_err()),
                "invalidFolderName",
                "{bad}"
            );
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn moves_document_with_its_images_and_dedupes_names() {
        let root = temp_dir("move");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets/pic.png"), "png").unwrap();
        fs::create_dir_all(root.join("Work")).unwrap();
        fs::write(root.join("Work/note.md"), "已有").unwrap();
        fs::write(
            root.join("note.md"),
            "![图](assets/pic.png) ![外](https://x.com/a.png) ![逃](../secret.png)",
        )
        .unwrap();

        let moved = move_document(&root.join("note.md"), &root.join("Work")).unwrap();
        assert!(moved.ends_with("Work/note-2.md"));
        assert!(!root.join("note.md").exists());
        assert!(root.join("Work/assets/pic.png").is_file());
        // 原图还在
        assert!(root.join("assets/pic.png").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn moving_into_the_same_folder_is_a_no_op() {
        let root = temp_dir("same");
        fs::write(root.join("a.md"), "a").unwrap();
        let path = move_document(&root.join("a.md"), &root).unwrap();
        assert_eq!(path, root.join("a.md").to_string_lossy());
        let _ = fs::remove_dir_all(&root);
    }
}
