//! 文件访问授权
//!
//! 前端传来的路径一律不可信：文件命令只放行
//! - 文档库目录（由用户在 Rust 弹出的对话框里选定，或使用默认位置）内的路径；
//! - 本次运行中用户通过 Rust 弹出的对话框亲手选过的文件（⌘O 打开 / 导出目标）。
//!
//! 判断一律基于规范化后的绝对路径（解析符号链接与 `..`），
//! 杜绝 `库/../别处` 或库内符号链接指向库外这类绕过。
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use crate::fs_ops::CommandError;

/// 由 tauri 托管的授权状态
#[derive(Default)]
pub struct AccessState(pub Mutex<Access>);

#[derive(Debug, Default)]
pub struct Access {
    /// 文档库根目录（规范化）
    library: Option<PathBuf>,
    /// ⌘O 打开的库外文档（规范化）
    opened_files: HashSet<PathBuf>,
    /// 导出对话框选定的目标文件（规范化）
    export_targets: HashSet<PathBuf>,
}

fn denied(path: &Path) -> CommandError {
    CommandError::new("accessDenied", path.display().to_string())
}

/// 规范化路径：必须是绝对路径；已存在则解析符号链接，
/// 不存在则要求父目录存在，并以规范化父目录 + 文件名表示。
pub fn normalize(path: &Path) -> Result<PathBuf, CommandError> {
    if !path.is_absolute() {
        return Err(denied(path));
    }
    if let Ok(real) = path.canonicalize() {
        return Ok(real);
    }
    let name = match path.components().next_back() {
        Some(Component::Normal(name)) => name.to_owned(),
        _ => return Err(denied(path)),
    };
    let parent = path.parent().ok_or_else(|| denied(path))?;
    let parent = parent.canonicalize().map_err(|_| denied(path))?;
    Ok(parent.join(name))
}

impl Access {
    pub fn library(&self) -> Option<&Path> {
        self.library.as_deref()
    }

    /// 设定文档库（目录必须已存在），返回规范化后的路径
    pub fn set_library(&mut self, root: &Path) -> Result<PathBuf, CommandError> {
        let root = normalize(root)?;
        if !root.is_dir() {
            return Err(denied(&root));
        }
        self.library = Some(root.clone());
        Ok(root)
    }

    pub fn grant_opened_file(&mut self, path: &Path) -> Result<(), CommandError> {
        self.opened_files.insert(normalize(path)?);
        Ok(())
    }

    pub fn grant_export_target(&mut self, path: &Path) -> Result<(), CommandError> {
        self.export_targets.insert(normalize(path)?);
        Ok(())
    }

    fn in_library(&self, normalized: &Path) -> bool {
        self.library
            .as_deref()
            .is_some_and(|root| normalized.starts_with(root))
    }

    /// 必须恰好是文档库根目录（列表 / 正文搜索 / 监听）
    pub fn check_library_root(&self, root: &Path) -> Result<(), CommandError> {
        let normalized = normalize(root)?;
        if self.library.as_deref() == Some(normalized.as_path()) {
            Ok(())
        } else {
            Err(denied(root))
        }
    }

    /// 文档读写 / 重命名 / 删除：库内，或用户打开过的库外文件。
    /// 只能是文件：库根目录或子文件夹交给 delete_document 会整个移进废纸篓
    pub fn check_document(&self, path: &Path) -> Result<(), CommandError> {
        let normalized = normalize(path)?;
        if self.library.as_deref() == Some(normalized.as_path()) || normalized.is_dir() {
            return Err(denied(path));
        }
        if self.in_library(&normalized) || self.opened_files.contains(&normalized) {
            Ok(())
        } else {
            Err(denied(path))
        }
    }

    /// 文档所在目录（新建 / 图片 / 冲突副本）：库内，或库外文档的同级目录
    pub fn check_document_dir(&self, dir: &Path) -> Result<(), CommandError> {
        let normalized = normalize(dir)?;
        let beside_opened = self
            .opened_files
            .iter()
            .any(|file| file.parent() == Some(normalized.as_path()));
        if self.in_library(&normalized) || beside_opened {
            Ok(())
        } else {
            Err(denied(dir))
        }
    }

    /// 导出写入：只能是导出对话框选定的那个文件
    pub fn check_export_target(&self, path: &Path) -> Result<(), CommandError> {
        if self.export_targets.contains(&normalize(path)?) {
            Ok(())
        } else {
            Err(denied(path))
        }
    }

    /// 导出时复制 assets 的目标目录：只能是某个导出目标的所在目录
    pub fn check_export_dir(&self, dir: &Path) -> Result<(), CommandError> {
        let normalized = normalize(dir)?;
        if self
            .export_targets
            .iter()
            .any(|target| target.parent() == Some(normalized.as_path()))
        {
            Ok(())
        } else {
            Err(denied(dir))
        }
    }

    /// 库外文档重命名后，授权跟着走
    pub fn rename_opened_file(&mut self, from: &Path, to: &Path) {
        if let Ok(from) = normalize(from) {
            if self.opened_files.remove(&from) {
                if let Ok(to) = normalize(to) {
                    self.opened_files.insert(to);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ink-access-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn library_access(tag: &str) -> (Access, PathBuf, PathBuf) {
        let base = temp_dir(tag);
        let library = base.join("library");
        let outside = base.join("outside");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let mut access = Access::default();
        access.set_library(&library).unwrap();
        (access, library, outside)
    }

    #[test]
    fn allows_library_paths_including_new_files() {
        let (access, library, _) = library_access("inside");
        fs::write(library.join("a.md"), "x").unwrap();
        assert!(access.check_document(&library.join("a.md")).is_ok());
        assert!(access.check_document(&library.join("new.md")).is_ok());
        assert!(access.check_document_dir(&library).is_ok());
        assert!(access.check_library_root(&library).is_ok());
    }

    #[test]
    fn rejects_library_root_and_folders_as_documents() {
        let (access, library, _) = library_access("folders");
        fs::create_dir_all(library.join("sub")).unwrap();
        assert!(access.check_document(&library).is_err());
        assert!(access.check_document(&library.join("sub")).is_err());
    }

    #[test]
    fn rejects_paths_outside_library() {
        let (access, library, outside) = library_access("outside");
        fs::write(outside.join("secret.md"), "x").unwrap();
        assert!(access.check_document(&outside.join("secret.md")).is_err());
        assert!(access.check_document_dir(&outside).is_err());
        assert!(access.check_library_root(&outside).is_err());
        assert!(access.check_library_root(&library.join("sub")).is_err());
        assert!(access.check_document(Path::new("relative.md")).is_err());
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let (access, library, _) = library_access("traversal");
        let escape = library.join("..").join("outside").join("secret.md");
        assert!(access.check_document(&escape).is_err());
        assert!(access.check_document(&library.join("..")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escaping_library() {
        let (access, library, outside) = library_access("symlink");
        fs::write(outside.join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(&outside, library.join("link")).unwrap();
        assert!(access
            .check_document(&library.join("link").join("secret.md"))
            .is_err());
    }

    #[test]
    fn library_prefix_is_component_based() {
        let (access, library, _) = library_access("prefix");
        let sibling = PathBuf::from(format!("{}2", library.display()));
        fs::create_dir_all(&sibling).unwrap();
        assert!(access.check_document(&sibling.join("a.md")).is_err());
    }

    #[test]
    fn opened_file_grants_only_that_file_and_its_directory() {
        let (mut access, _, outside) = library_access("opened");
        let file = outside.join("notes.md");
        fs::write(&file, "x").unwrap();
        fs::write(outside.join("other.md"), "x").unwrap();
        access.grant_opened_file(&file).unwrap();

        assert!(access.check_document(&file).is_ok());
        assert!(access.check_document_dir(&outside).is_ok());
        assert!(access.check_document(&outside.join("other.md")).is_err());
    }

    #[test]
    fn rename_moves_opened_file_grant() {
        let (mut access, _, outside) = library_access("rename");
        let from = outside.join("a.md");
        let to = outside.join("b.md");
        fs::write(&from, "x").unwrap();
        access.grant_opened_file(&from).unwrap();
        fs::rename(&from, &to).unwrap();
        access.rename_opened_file(&from, &to);

        assert!(access.check_document(&to).is_ok());
        assert!(access.check_document(&from).is_err());
    }

    #[test]
    fn export_grants_only_chosen_target() {
        let (mut access, _, outside) = library_access("export");
        let target = outside.join("out.html");
        access.grant_export_target(&target).unwrap();

        assert!(access.check_export_target(&target).is_ok());
        assert!(access.check_export_dir(&outside).is_ok());
        assert!(access
            .check_export_target(&outside.join("other.html"))
            .is_err());
        // 导出授权不等于文档授权
        assert!(access.check_document(&target).is_err());
    }
}
