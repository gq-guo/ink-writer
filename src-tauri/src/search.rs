//! 正文搜索（spec §14.2）
//!
//! 不建索引（R9）：逐文件做大小写不敏感子串匹配，每文件最多 3 条命中，全库最多 50 条。
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::encoding;
use crate::fs_ops::{self, CommandError, DocumentMeta};

/// 单文件大小上限（超过则跳过）
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
/// 全库命中上限
const MAX_HITS: usize = 50;
/// 每个文件最多命中数
const MAX_HITS_PER_FILE: usize = 3;
/// 片段前后各 30 字符
const SNIPPET_PADDING: usize = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub file_name: String,
    pub dir_prefix: String,
    pub line: usize,
    pub snippet: String,
    /// 命中词在文件中的起始位置（UTF-16 偏移，即 CodeMirror 的 position）
    pub start: usize,
    /// 命中词结束位置（UTF-16 偏移）
    pub end: usize,
}

fn ci_eq(a: char, b: char) -> bool {
    if a.is_ascii() && b.is_ascii() {
        a.eq_ignore_ascii_case(&b)
    } else {
        a.to_lowercase().eq(b.to_lowercase())
    }
}

/// 在字符数组中做大小写不敏感查找，返回字符下标
fn find_ci(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    for i in 0..=(haystack.len() - needle.len()) {
        if haystack[i..i + needle.len()]
            .iter()
            .zip(needle.iter())
            .all(|(a, b)| ci_eq(*a, *b))
        {
            return Some(i);
        }
    }
    None
}

fn utf16_len(chars: &[char]) -> usize {
    chars.iter().map(|c| c.len_utf16()).sum()
}

/// 行内第 `pos` 个字符起、长 `len` 个字符的区间，换算成 UTF-16 偏移
/// （CodeMirror 的位置单位；按 UTF-8 字节算的话中文会偏到三倍远）
fn utf16_range(chars: &[char], pos: usize, len: usize) -> (usize, usize) {
    let start = utf16_len(&chars[..pos]);
    let end = start + utf16_len(&chars[pos..(pos + len).min(chars.len())]);
    (start, end)
}

fn snippet_for(line: &str, char_index: usize, needle_len: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    let start = char_index.saturating_sub(SNIPPET_PADDING);
    let end = (char_index + needle_len + SNIPPET_PADDING).min(chars.len());
    let slice: String = chars[start..end].iter().collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < chars.len() { "…" } else { "" };
    format!("{}{}{}", prefix, slice.trim(), suffix)
}

pub fn search_content(root: &Path, query: &str) -> Result<Vec<SearchHit>, CommandError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let needle: Vec<char> = trimmed.to_lowercase().chars().collect();

    let docs: Vec<DocumentMeta> = fs_ops::list_documents(root)?;
    let mut hits: Vec<SearchHit> = Vec::new();

    for doc in docs {
        if hits.len() >= MAX_HITS {
            break;
        }
        if doc.size > MAX_FILE_SIZE {
            continue;
        }
        let path = Path::new(&doc.path);
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        let Ok(decoded) = encoding::decode(&bytes) else {
            continue;
        };
        let text = encoding::normalize_to_lf(&decoded.text);

        let mut per_file = 0;
        let mut line_start = 0usize;
        for (index, line) in text.lines().enumerate() {
            if per_file >= MAX_HITS_PER_FILE {
                break;
            }
            let chars: Vec<char> = line.chars().collect();
            if let Some(pos) = find_ci(&chars, &needle) {
                let (start, end) = utf16_range(&chars, pos, needle.len());
                hits.push(SearchHit {
                    path: doc.path.clone(),
                    file_name: doc.file_name.clone(),
                    dir_prefix: doc.dir_prefix.clone(),
                    line: index + 1,
                    snippet: snippet_for(line, pos, needle.len()),
                    start: line_start + start,
                    end: line_start + end,
                });
                per_file += 1;
            }
            line_start += utf16_len(&chars) + 1;
        }
    }

    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_case_insensitive_matches() {
        let hay: Vec<char> = "Hello World".chars().collect();
        let needle: Vec<char> = "world".chars().collect();
        assert_eq!(find_ci(&hay, &needle), Some(6));
    }

    #[test]
    fn crlf_lines_count_as_one_newline() {
        let root = std::env::temp_dir().join(format!("ink-search-crlf-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        // CRLF 与中文 / emoji：编辑器里换行是一个字符，😀 占两个 UTF-16 单元
        let text = "第一行\r\n😀 中文 Ink 写作\r\n";
        fs::write(root.join("a.md"), text).unwrap();

        let hits = search_content(&root, "写作").unwrap();
        assert_eq!(hits.len(), 1);
        let editor_text: Vec<u16> = text.replace("\r\n", "\n").encode_utf16().collect();
        let found = String::from_utf16(&editor_text[hits[0].start..hits[0].end]).unwrap();
        assert_eq!(found, "写作");
        assert_eq!(hits[0].line, 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn offsets_are_utf16_code_units() {
        let dir = std::env::temp_dir().join(format!("ink-search-utf16-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let text = "第一行\n中文 😀 关键词 here";
        fs::write(dir.join("a.md"), text).unwrap();

        let hits = search_content(&dir, "关键词").unwrap();
        assert_eq!(hits.len(), 1);
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let found = String::from_utf16(&utf16[hits[0].start..hits[0].end]).unwrap();
        assert_eq!(found, "关键词");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_match_returns_none() {
        let hay: Vec<char> = "Hello".chars().collect();
        let needle: Vec<char> = "xyz".chars().collect();
        assert_eq!(find_ci(&hay, &needle), None);
    }
}
