//! 行内标签 `#tag`
//!
//! 与正文搜索一样不建索引（R9）：逐文件扫描。规则（与前端 src/editor/tags.ts 保持一致）：
//! - `#` 在行首或空白之后（`url#anchor`、`[a](#b)`、`\#x`、`##` 都不算）
//! - 后面是字母 / 数字（含中文）/ `_` / `-` / `/`，遇到空格或标点结束；末尾的 `-` `/` 不算
//! - 不能全是数字（`#1`、`#2024` 不算）
//! - 围栏代码块、行内代码里的不算
//!
//! 返回的位置是 UTF-16 偏移（与编辑器的文档位置一致），不是字节偏移。
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::encoding;
use crate::fs_ops::{self, CommandError, DocumentMeta};

/// 单文件大小上限（超过则跳过）
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
/// 全库命中上限
const MAX_HITS: usize = 100;
/// 每个文件最多命中数
const MAX_HITS_PER_FILE: usize = 10;
/// 片段前后各 30 字符
const SNIPPET_PADDING: usize = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagHit {
    pub path: String,
    pub file_name: String,
    pub dir_prefix: String,
    pub line: usize,
    pub snippet: String,
    /// 标签（含 #）在文档中的起点，UTF-16 偏移
    pub start: usize,
    /// 标签结束位置，UTF-16 偏移
    pub end: usize,
    /// 标签原文（不含 #）
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

/// 一行里的一个标签：`#` 与标签末尾的字节位置（行内），标签原文（不含 #）
#[derive(Debug, PartialEq)]
pub struct LineTag {
    pub start: usize,
    pub end: usize,
    pub tag: String,
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// 行内代码的字节区间：成对的、等长的反引号串之间（含反引号）
fn inline_code_ranges(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let open_start = i;
        while i < bytes.len() && bytes[i] == b'`' {
            i += 1;
        }
        let run = i - open_start;
        // 找下一个等长的反引号串
        let mut j = i;
        let mut closed = None;
        while j < bytes.len() {
            if bytes[j] != b'`' {
                j += 1;
                continue;
            }
            let close_start = j;
            while j < bytes.len() && bytes[j] == b'`' {
                j += 1;
            }
            if j - close_start == run {
                closed = Some(j);
                break;
            }
        }
        if let Some(end) = closed {
            ranges.push((open_start, end));
            i = end;
        }
    }
    ranges
}

/// 找出一行里的标签（调用方负责跳过围栏代码块里的行）
pub fn tags_in_line(line: &str) -> Vec<LineTag> {
    let code = inline_code_ranges(line);
    let mut out = Vec::new();
    let mut prev: Option<char> = None;
    let mut iter = line.char_indices().peekable();
    while let Some((index, c)) = iter.next() {
        let at_boundary = prev.is_none_or(char::is_whitespace);
        prev = Some(c);
        if c != '#' || !at_boundary || code.iter().any(|&(s, e)| index >= s && index < e) {
            continue;
        }
        let body_start = index + 1;
        let mut body_end = body_start;
        while let Some(&(next_index, next)) = iter.peek() {
            if !is_tag_char(next) {
                break;
            }
            body_end = next_index + next.len_utf8();
            prev = Some(next);
            iter.next();
        }
        let body = line[body_start..body_end].trim_end_matches(['-', '/']);
        if body.is_empty() || body.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        out.push(LineTag {
            start: index,
            end: body_start + body.len(),
            tag: body.to_string(),
        });
    }
    out
}

/// 围栏行（``` / ~~~）：返回围栏字符与长度
fn fence_of(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let first = trimmed.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let run = trimmed.chars().take_while(|&c| c == first).count();
    (run >= 3).then_some((first, run))
}

/// 逐行回调（跳过围栏代码块）：行号从 1 开始、行首的 UTF-16 偏移、行文本
fn for_each_prose_line(text: &str, mut visit: impl FnMut(usize, usize, &str) -> bool) {
    let mut fence: Option<(char, usize)> = None;
    let mut utf16_offset = 0usize;
    for (index, line) in text.lines().enumerate() {
        let line_start = utf16_offset;
        utf16_offset += line.encode_utf16().count() + 1;
        if let Some((ch, run)) = fence_of(line) {
            match fence {
                None => fence = Some((ch, run)),
                Some((open_ch, open_run))
                    if ch == open_ch && run >= open_run && line.trim().chars().all(|c| c == ch) =>
                {
                    fence = None
                }
                _ => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if !visit(index + 1, line_start, line) {
            break;
        }
    }
}

fn read_library_text(doc: &DocumentMeta) -> Option<String> {
    if doc.size > MAX_FILE_SIZE {
        return None;
    }
    let bytes = fs::read(Path::new(&doc.path)).ok()?;
    let decoded = encoding::decode(&bytes).ok()?;
    Some(encoding::normalize_to_lf(&decoded.text))
}

fn snippet_for(line: &str, byte_start: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    let char_index = line[..byte_start].chars().count();
    let start = char_index.saturating_sub(SNIPPET_PADDING);
    let end = (char_index + SNIPPET_PADDING * 2).min(chars.len());
    let slice: String = chars[start..end].iter().collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < chars.len() { "…" } else { "" };
    format!("{}{}{}", prefix, slice.trim(), suffix)
}

/// 标签以 query 开头（大小写不敏感；query 可带 #）的命中，按文档 mtime 倒序
pub fn search_tags(root: &Path, query: &str) -> Result<Vec<TagHit>, CommandError> {
    let needle = query.trim().trim_start_matches('#').to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits = Vec::new();
    for doc in fs_ops::list_documents(root)? {
        if hits.len() >= MAX_HITS {
            break;
        }
        let Some(text) = read_library_text(&doc) else {
            continue;
        };
        let mut per_file = 0;
        for_each_prose_line(&text, |line_number, line_start, line| {
            for tag in tags_in_line(line) {
                if !tag.tag.to_lowercase().starts_with(&needle) {
                    continue;
                }
                let start = line_start + line[..tag.start].encode_utf16().count();
                hits.push(TagHit {
                    path: doc.path.clone(),
                    file_name: doc.file_name.clone(),
                    dir_prefix: doc.dir_prefix.clone(),
                    line: line_number,
                    snippet: snippet_for(line, tag.start),
                    start,
                    end: start + line[tag.start..tag.end].encode_utf16().count(),
                    tag: tag.tag,
                });
                per_file += 1;
                // 一行有多个匹配的标签只记一次
                break;
            }
            per_file < MAX_HITS_PER_FILE && hits.len() < MAX_HITS
        });
    }
    Ok(hits)
}

/// 全库的标签与出现次数（大小写不同算同一个，显示最近修改的那篇里的写法），按次数倒序
pub fn list_tags(root: &Path) -> Result<Vec<TagCount>, CommandError> {
    let mut counts: HashMap<String, TagCount> = HashMap::new();
    for doc in fs_ops::list_documents(root)? {
        let Some(text) = read_library_text(&doc) else {
            continue;
        };
        for_each_prose_line(&text, |_, _, line| {
            for tag in tags_in_line(line) {
                counts
                    .entry(tag.tag.to_lowercase())
                    .or_insert(TagCount {
                        tag: tag.tag,
                        count: 0,
                    })
                    .count += 1;
            }
            true
        });
    }
    let mut list: Vec<TagCount> = counts.into_values().collect();
    list.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.tag.to_lowercase().cmp(&b.tag.to_lowercase()))
    });
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(line: &str) -> Vec<String> {
        tags_in_line(line).into_iter().map(|t| t.tag).collect()
    }

    #[test]
    fn finds_tags_after_whitespace_or_line_start() {
        assert_eq!(
            tags("#写作 今天 #work/2026 和 #a_b-c"),
            vec!["写作", "work/2026", "a_b-c"]
        );
    }

    #[test]
    fn tag_ends_at_punctuation_and_trims_trailing_separators() {
        assert_eq!(
            tags("记一下 #读书，明天 #plan. 还有 #x- #y/"),
            vec!["读书", "plan", "x", "y"]
        );
    }

    #[test]
    fn ignores_headings_anchors_escapes_and_numbers() {
        assert!(tags("# 标题").is_empty());
        assert!(tags("## 二级").is_empty());
        assert!(tags("见 https://a.com/#top 与 [链接](#sec)").is_empty());
        assert!(tags("\\#不是 中文#不是 #1 #2024").is_empty());
        assert_eq!(tags("## 计划 #work"), vec!["work"]);
    }

    #[test]
    fn ignores_inline_code() {
        assert_eq!(tags("`#code` 和 ``#also`` 外面 #real"), vec!["real"]);
        // 没闭合的反引号不算代码
        assert_eq!(tags("` #open"), vec!["open"]);
    }

    #[test]
    fn positions_are_byte_offsets_within_line() {
        let line = "中文 #标签";
        let found = tags_in_line(line);
        assert_eq!(&line[found[0].start..found[0].end], "#标签");
    }

    #[test]
    fn skips_fenced_code_and_reports_utf16_offsets() {
        let text = "第一行 #a\n```\n#inside\n```\n中文 #b";
        let mut seen = Vec::new();
        for_each_prose_line(text, |line, start, content| {
            for tag in tags_in_line(content) {
                let utf16 = start + content[..tag.start].encode_utf16().count();
                seen.push((line, tag.tag, utf16));
            }
            true
        });
        // "第一行 #a\n" = 6 个 UTF-16 单元 + 换行；"```\n#inside\n```\n" = 16
        assert_eq!(
            seen,
            vec![(1, "a".to_string(), 4), (5, "b".to_string(), 7 + 16 + 3)]
        );
    }

    #[test]
    fn searches_and_lists_tags_across_library() {
        let root = std::env::temp_dir().join(format!("ink-tags-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Work")).unwrap();
        fs::write(root.join("a.md"), "今天 #Work 开会\n\n`#code` 不算\n").unwrap();
        fs::write(
            root.join("Work/b.md"),
            "#workshop 报名\n#work 再来一次 #读书\n",
        )
        .unwrap();

        let mut hits = search_tags(&root, "#work").unwrap();
        hits.sort_by(|a, b| (&a.file_name, a.line).cmp(&(&b.file_name, b.line)));
        let found: Vec<(&str, usize, &str, usize)> = hits
            .iter()
            .map(|h| (h.file_name.as_str(), h.line, h.tag.as_str(), h.start))
            .collect();
        assert_eq!(
            found,
            vec![
                ("a.md", 1, "Work", 3),
                ("b.md", 1, "workshop", 0),
                ("b.md", 2, "work", 13)
            ]
        );
        assert!(search_tags(&root, "").unwrap().is_empty());

        // 大小写不同算同一个标签（显示哪种写法取决于哪篇文档更新）
        let listed: Vec<(String, usize)> = list_tags(&root)
            .unwrap()
            .into_iter()
            .map(|t| (t.tag.to_lowercase(), t.count))
            .collect();
        assert_eq!(
            listed,
            vec![
                ("work".to_string(), 2),
                ("workshop".to_string(), 1),
                ("读书".to_string(), 1)
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }
}
