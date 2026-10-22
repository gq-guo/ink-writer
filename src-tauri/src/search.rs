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
    /// 命中词在文件中的字节偏移
    pub start: usize,
    /// 命中词结束位置（字节偏移）
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
        if haystack[i..i + needle.len()].iter().zip(needle.iter()).all(|(a, b)| ci_eq(*a, *b)) {
            return Some(i);
        }
    }
    None
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
        let mut byte_offset = 0usize;
        for (index, line) in text.lines().enumerate() {
            if per_file >= MAX_HITS_PER_FILE {
                break;
            }
            let line_start = byte_offset;
            byte_offset += line.len() + 1;
            let chars: Vec<char> = line.chars().collect();
            if let Some(pos) = find_ci(&chars, &needle) {
                let byte_in_line = line
                    .char_indices()
                    .nth(pos)
                    .map(|(offset, _)| offset)
                    .unwrap_or(0);
                let matched: String = chars.iter().skip(pos).take(needle.len()).collect();
                hits.push(SearchHit {
                    path: doc.path.clone(),
                    file_name: doc.file_name.clone(),
                    dir_prefix: doc.dir_prefix.clone(),
                    line: index + 1,
                    snippet: snippet_for(line, pos, needle.len()),
                    start: line_start + byte_in_line,
                    end: line_start + byte_in_line + matched.len(),
                });
                per_file += 1;
            }
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
    fn no_match_returns_none() {
        let hay: Vec<char> = "Hello".chars().collect();
        let needle: Vec<char> = "xyz".chars().collect();
        assert_eq!(find_ci(&hay, &needle), None);
    }
}
