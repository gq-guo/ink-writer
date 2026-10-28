//! 文件夹：列出、新建，把文档移到别的文件夹
//!
//! 文件夹就是库目录下的普通子目录。侧栏只列「有文档（任意层级）」或「完全空（刚建的）」的目录，
//! 隐藏目录与只放图片的 assets/ 之类不出现。
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Component, Path, PathBuf};

use pulldown_cmark::{Event, Parser, Tag};

use crate::encoding;
use crate::fs_ops::{
    io_message, is_hidden, is_markdown, is_same_file, is_single_file_name, CommandError,
};

/// 移动文档时跟着复制的图片类型（其他引用 —— 比如 `![](other.md)` —— 不复制，免得多出一篇文档）
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "heif", "tif", "tiff", "ico",
];

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
            // 只有隐藏文件（Finder 打开过就会有 .DS_Store）也算空文件夹
            let empty = fs::read_dir(&path)
                .map(|it| {
                    it.flatten()
                        .all(|e| is_hidden(&e.file_name().to_string_lossy()))
                })
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

/// 文件夹名只能是单个名字：不含 `/`、`\`、`\0`、`..`，不以 `.` 开头。
///
/// 光靠 is_single_file_name 不够：Path::components 会吞掉结尾的 `/`，
/// `Archive/`、`Archive/.` 也算单个分量，rename 能成功，返回的路径却带着 `/`，
/// 前端拼出 `Archive//Note.md` 这样的路径，和 watcher 事件对不上
fn is_valid_folder_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\', '\0']) && is_single_file_name(name)
}

/// 在 parent 下新建文件夹；name 的规则见 is_valid_folder_name
pub fn create_folder(parent: &Path, name: &str) -> Result<String, CommandError> {
    let name = name.trim();
    if !is_valid_folder_name(name) {
        return Err(CommandError::new("invalidFolderName", name));
    }
    let target = parent.join(name);
    if target.exists() {
        return Err(CommandError::new("folderExists", name));
    }
    fs::create_dir(&target).map_err(|e| io_message(&target, &e))?;
    Ok(target.to_string_lossy().to_string())
}

/// 重命名文件夹（只改最后一级名字，内容跟着走），返回新路径。
///
/// new_name 的规则和新建时一样；目标已有同名文件夹时报 folderExists。
/// 只差大小写的改名在大小写不敏感的卷（macOS 默认）上 target.exists() 也为真，
/// 但那是同一个目录，照常 rename —— 否则永远改不了大小写。
pub fn rename_folder(path: &Path, new_name: &str) -> Result<String, CommandError> {
    let name = new_name.trim();
    if !is_valid_folder_name(name) {
        return Err(CommandError::new("invalidFolderName", name));
    }
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::new("invalidPath", path.display().to_string()))?;
    if !path.is_dir() {
        return Err(CommandError::new("notFound", path.display().to_string()));
    }
    let target = parent.join(name);
    if target.exists() && !is_same_file(path, &target) {
        return Err(CommandError::new("folderExists", name));
    }
    fs::rename(path, &target).map_err(|e| io_message(&target, &e))?;
    Ok(target.to_string_lossy().to_string())
}

/// 把文档移到 target_dir（保留文件名，重名时加 `-2`、`-3`……），返回新路径。
///
/// 不覆盖目标位置已有的文件：先建硬链接（目标已存在时原子地失败）再删原文件，
/// 不用「先查是否存在再 rename」—— 两步之间同步软件放进来的同名文件会被 rename 悄悄覆盖。
///
/// 文档里用相对路径引用的图片（`![](assets/a.png)`）一并复制过去，移动后图片不会断：
/// 只复制，不删原图（别的文档可能也在用）；目标已有同名文件时不覆盖。见 copy_image 的安全约束
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
    let images = fs::read(path)
        .ok()
        .and_then(|bytes| encoding::decode(&bytes).ok())
        .map(|decoded| relative_images(&decoded.text))
        .unwrap_or_default();

    let mut counter = 1;
    let target = loop {
        let candidate = if counter == 1 {
            target_dir.join(&file_name)
        } else {
            target_dir.join(format!("{}-{}{}", stem, counter, ext))
        };
        counter += 1;
        if counter > 9999 {
            return Err(CommandError::new("tooManyDuplicates", file_name));
        }
        match move_exclusive(path, &candidate) {
            Ok(()) => break candidate,
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io_message(path, &e)),
        }
    };
    for image in images {
        copy_image(source_dir, target_dir, &image);
    }
    Ok(target.to_string_lossy().to_string())
}

/// 把 from 移到 to；to 已存在时返回 AlreadyExists，不覆盖
fn move_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    match fs::hard_link(from, to) {
        Ok(()) => fs::remove_file(from).inspect_err(|_| {
            // 删不掉原文件：撤掉刚建的链接，保持原样
            let _ = fs::remove_file(to);
        }),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err(e),
        // 文件系统不支持硬链接（部分网络盘 / exFAT）：退回 rename，只能先确认目标不存在
        Err(_) => {
            if fs::symlink_metadata(to).is_ok() {
                return Err(io::Error::from(ErrorKind::AlreadyExists));
            }
            fs::rename(from, to)
        }
    }
}

/// %XX 解码（`a%20b.png` → `a b.png`）；解出来不是 UTF-8 时返回 None
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(high * 16 + low);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

/// 文档里引用的本地图片的相对路径：
/// - 只要图片扩展名（`![](other.md)` 之类不算）；去掉 `?query` / `#fragment`，%XX 解码
/// - 不含协议、不以 `/` 开头、不含 `..`（不会指到文档目录外面）
fn relative_images(text: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for event in Parser::new(text) {
        let Event::Start(Tag::Image { dest_url, .. }) = event else {
            continue;
        };
        if dest_url.contains("://") || dest_url.starts_with("data:") {
            continue;
        }
        let raw = dest_url.split(['?', '#']).next().unwrap_or_default();
        let Some(decoded) = percent_decode(raw) else {
            continue;
        };
        let relative = PathBuf::from(decoded);
        let is_image = relative
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()));
        let safe = relative.components().count() > 0
            && relative
                .components()
                .all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
        if is_image && safe && !out.contains(&relative) {
            out.push(relative);
        }
    }
    out
}

/// relative 的普通路径段（去掉 `.`）
fn normal_parts(relative: &Path) -> Vec<&std::ffi::OsStr> {
    relative
        .components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part),
            _ => None,
        })
        .collect()
}

/// base 下沿 relative 走到的普通文件；途中任何一级是符号链接（或不存在、不是目录）都返回 None。
/// 只检查最后一级不够：`assets` 本身是指向库外的符号链接时，`assets/x.png` 会读到库外的文件
fn plain_file_under(base: &Path, relative: &Path) -> Option<PathBuf> {
    let parts = normal_parts(relative);
    let (last, dirs) = parts.split_last()?;
    let mut current = base.to_path_buf();
    for part in dirs {
        current.push(part);
        let meta = fs::symlink_metadata(&current).ok()?;
        if !meta.is_dir() {
            return None;
        }
    }
    current.push(last);
    fs::symlink_metadata(&current)
        .ok()
        .filter(|meta| meta.is_file())
        .map(|_| current)
}

/// 在 base 下逐级建出 relative 的父目录；已有的每一级必须是真目录（不是符号链接），返回最终文件路径
fn plain_dirs_under(base: &Path, relative: &Path) -> Option<PathBuf> {
    let parts = normal_parts(relative);
    let (last, dirs) = parts.split_last()?;
    let mut current = base.to_path_buf();
    for part in dirs {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return None,
            // 一级一级 create_dir（不是 create_dir_all）：不会顺着已有的符号链接在库外建目录
            Err(e) if e.kind() == ErrorKind::NotFound => fs::create_dir(&current).ok()?,
            Err(_) => return None,
        }
    }
    current.push(last);
    Some(current)
}

/// 复制一张图到新目录的同一相对位置。安全约束（文档内容不可信）：
/// - 源路径的每一级都不能是符号链接，最后一级必须是普通文件（不读库外的文件）
/// - 目标路径已有的每一级都必须是真目录；目标文件用 create_new 打开：已存在（包括指向别处的
///   符号链接、哪怕是悬空的）就失败，不覆盖、也不会顺着符号链接写到库外
fn copy_image(source_dir: &Path, target_dir: &Path, relative: &Path) {
    let Some(from) = plain_file_under(source_dir, relative) else {
        return;
    };
    let Some(to) = plain_dirs_under(target_dir, relative) else {
        return;
    };
    let Ok(mut reader) = fs::File::open(&from) else {
        return;
    };
    let Ok(mut writer) = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&to)
    else {
        return;
    };
    if io::copy(&mut reader, &mut writer).is_err() {
        drop(writer);
        let _ = fs::remove_file(&to);
    }
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
        for bad in [
            "", "a/b", "..", ".hidden", "../out", "a/", "a//", "a/.", "a\\b", "a\0b",
        ] {
            assert_eq!(
                code_of(create_folder(&root, bad).unwrap_err()),
                "invalidFolderName",
                "{bad}"
            );
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renames_folder_in_place_and_rejects_bad_names() {
        let root = temp_dir("rename");
        fs::create_dir_all(root.join("Work/Drafts")).unwrap();
        fs::write(root.join("Work/Drafts/a.md"), "a").unwrap();
        fs::create_dir_all(root.join("Work/Taken")).unwrap();

        let made = rename_folder(&root.join("Work/Drafts"), " 旧稿 ").unwrap();
        assert!(Path::new(&made).is_dir());
        assert!(root.join("Work/旧稿/a.md").is_file());
        assert!(!root.join("Work/Drafts").exists());

        assert_eq!(
            code_of(rename_folder(&root.join("Work/旧稿"), "Taken").unwrap_err()),
            "folderExists"
        );
        for bad in [
            "", "a/b", "..", ".hidden", "../out", "a/", "a//", "a/.", "a\\b", "a\0b",
        ] {
            assert_eq!(
                code_of(rename_folder(&root.join("Work/旧稿"), bad).unwrap_err()),
                "invalidFolderName",
                "{bad}"
            );
        }
        // 只改大小写：大小写不敏感的卷上 target.exists() 为真，也得能改
        let made = rename_folder(&root.join("Work/Taken"), "taken").unwrap();
        assert_eq!(made, root.join("Work/taken").to_string_lossy());
        let names: Vec<_> = fs::read_dir(root.join("Work"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(names.iter().any(|name| name == "taken"));
        assert!(!names.iter().any(|name| name == "Taken"));
        assert_eq!(
            code_of(rename_folder(&root.join("Work/missing"), "x").unwrap_err()),
            "notFound"
        );
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

    #[test]
    fn hidden_files_dont_make_a_folder_non_empty() {
        let root = temp_dir("dsstore");
        fs::create_dir_all(root.join("New")).unwrap();
        fs::write(root.join("New/.DS_Store"), "x").unwrap();
        assert_eq!(list_folders(&root).unwrap(), vec!["New/"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copies_only_images_and_understands_query_and_percent_encoding() {
        assert_eq!(
            relative_images("![](a%20b.png?v=1) ![](c.JPG#x) ![](Work/other.md) ![](notes.txt)"),
            vec![PathBuf::from("a b.png"), PathBuf::from("c.JPG")]
        );
        // 坏的 %XX 原样保留，不 panic
        assert_eq!(relative_images("![](%zz%E4.png)"), Vec::<PathBuf>::new());
        assert_eq!(
            relative_images("![](50%.png)"),
            vec![PathBuf::from("50%.png")]
        );
    }

    #[cfg(unix)]
    mod symlinks {
        use super::*;
        use std::os::unix::fs::symlink;

        /// 库 + 库外目录；库里有一篇引用了 assets/pic.png 的文档和一个 Work 文件夹
        fn setup(tag: &str) -> (PathBuf, PathBuf) {
            let base = temp_dir(tag);
            let (library, outside) = (base.join("lib"), base.join("outside"));
            fs::create_dir_all(library.join("Work")).unwrap();
            fs::create_dir_all(&outside).unwrap();
            fs::write(library.join("n.md"), "![](assets/pic.png)").unwrap();
            (library, outside)
        }

        #[test]
        fn does_not_write_through_a_symlinked_target_folder() {
            let (library, outside) = setup("sym-target-dir");
            fs::create_dir_all(library.join("assets")).unwrap();
            fs::write(library.join("assets/pic.png"), "png").unwrap();
            symlink(&outside, library.join("Work/assets")).unwrap();

            move_document(&library.join("n.md"), &library.join("Work")).unwrap();
            assert!(!outside.join("pic.png").exists());
            let _ = fs::remove_dir_all(library.parent().unwrap());
        }

        #[test]
        fn does_not_write_through_a_dangling_symlinked_target_file() {
            let (library, outside) = setup("sym-target-file");
            fs::create_dir_all(library.join("assets")).unwrap();
            fs::write(library.join("assets/pic.png"), "png").unwrap();
            fs::create_dir_all(library.join("Work/assets")).unwrap();
            symlink(
                outside.join("planted.txt"),
                library.join("Work/assets/pic.png"),
            )
            .unwrap();

            move_document(&library.join("n.md"), &library.join("Work")).unwrap();
            assert!(!outside.join("planted.txt").exists());
            let _ = fs::remove_dir_all(library.parent().unwrap());
        }

        #[test]
        fn does_not_read_through_a_symlinked_source_folder() {
            let (library, outside) = setup("sym-source-dir");
            fs::write(outside.join("pic.png"), "SECRET").unwrap();
            symlink(&outside, library.join("assets")).unwrap();

            move_document(&library.join("n.md"), &library.join("Work")).unwrap();
            assert!(!library.join("Work/assets/pic.png").exists());
            let _ = fs::remove_dir_all(library.parent().unwrap());
        }
    }
}
