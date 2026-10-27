//! 行内标签 `#tag`
//!
//! 与正文搜索一样不建索引（R9）：逐文件扫描。规则（与前端 src/editor/tags.ts 保持一致）：
//! - `#` 在行首或空白之后（`url#anchor`、`[a](#b)`、`\#x`、`##` 都不算）
//! - 后面是字母 / 数字（含中文）/ `_` / `-` / `/`，遇到空格或标点结束；末尾的 `-` `/` 不算
//! - 不能全是数字（`#1`、`#2024` 不算）
//! - 代码块（围栏、缩进，含引用 / 列表里的）、行内代码、HTML 里的不算：
//!   用 pulldown-cmark 按 CommonMark 解析，与编辑器的语法树判断一致
//!
//! 返回的位置是 UTF-16 偏移（与编辑器的文档位置一致），不是字节偏移。
use std::collections::HashMap;
use std::fs;
use std::ops::Range;
use std::path::Path;

use pulldown_cmark::{Event, Options, Parser, Tag};
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
    /// 用到这个标签的文档（绝对路径，按文档 mtime 倒序，不重复）
    pub paths: Vec<String>,
}

/// 一行里的一个标签：`#` 与标签末尾的字节位置（行内），标签原文（不含 #）
#[derive(Debug, PartialEq)]
pub struct LineTag {
    pub start: usize,
    pub end: usize,
    pub tag: String,
}

/// 文档里的一个标签
struct TagSite<'a> {
    /// 从 1 开始
    line_number: usize,
    line: &'a str,
    tag: LineTag,
    /// 标签（含 #）在文档中的 UTF-16 区间
    utf16_start: usize,
    utf16_end: usize,
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// 找出一行文本里的标签（不判断代码块等上下文，见 for_each_tag）
pub fn tags_in_line(line: &str) -> Vec<LineTag> {
    let mut out = Vec::new();
    let mut prev: Option<char> = None;
    let mut iter = line.char_indices().peekable();
    while let Some((index, c)) = iter.next() {
        let at_boundary = prev.is_none_or(char::is_whitespace);
        prev = Some(c);
        if c != '#' || !at_boundary {
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

/// 代码块、行内代码、HTML 的字节区间（按起点排序、互不重叠）
fn code_ranges(text: &str) -> Vec<Range<usize>> {
    // 与编辑器一样按 GFM 解析（表格里的行内代码等）
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    Parser::new_ext(text, options)
        .into_offset_iter()
        .filter_map(|(event, range)| match event {
            Event::Start(Tag::CodeBlock(_))
            | Event::Start(Tag::HtmlBlock)
            | Event::Code(_)
            | Event::InlineHtml(_) => Some(range),
            _ => None,
        })
        .collect()
}

/// 按顺序回调文档里的每个标签（跳过代码与 HTML）；回调返回 false 时停止
fn for_each_tag(text: &str, mut visit: impl FnMut(TagSite) -> bool) {
    if !text.contains('#') {
        return;
    }
    let code = code_ranges(text);
    let mut code_index = 0;
    let mut byte_offset = 0usize;
    let mut utf16_offset = 0usize;
    for (index, line) in text.lines().enumerate() {
        let line_byte = byte_offset;
        let line_utf16 = utf16_offset;
        byte_offset += line.len() + 1;
        utf16_offset += line.encode_utf16().count() + 1;
        if !line.contains('#') {
            continue;
        }
        for tag in tags_in_line(line) {
            let at = line_byte + tag.start;
            while code_index < code.len() && code[code_index].end <= at {
                code_index += 1;
            }
            if code.get(code_index).is_some_and(|range| range.start <= at) {
                continue;
            }
            let utf16_start = line_utf16 + line[..tag.start].encode_utf16().count();
            let utf16_end = utf16_start + line[tag.start..tag.end].encode_utf16().count();
            let site = TagSite {
                line_number: index + 1,
                line,
                tag,
                utf16_start,
                utf16_end,
            };
            if !visit(site) {
                return;
            }
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
        let mut last_line = 0;
        for_each_tag(&text, |site| {
            // 一行有多个匹配的标签只记一次
            if site.line_number == last_line || !site.tag.tag.to_lowercase().starts_with(&needle) {
                return true;
            }
            last_line = site.line_number;
            hits.push(TagHit {
                path: doc.path.clone(),
                file_name: doc.file_name.clone(),
                dir_prefix: doc.dir_prefix.clone(),
                line: site.line_number,
                snippet: snippet_for(site.line, site.tag.start),
                start: site.utf16_start,
                end: site.utf16_end,
                tag: site.tag.tag,
            });
            per_file += 1;
            per_file < MAX_HITS_PER_FILE && hits.len() < MAX_HITS
        });
    }
    Ok(hits)
}

/// 全库的标签与出现次数（大小写不同算同一个，显示最近修改的那篇里的写法），按用到它的文档数倒序
pub fn list_tags(root: &Path) -> Result<Vec<TagCount>, CommandError> {
    let mut counts: HashMap<String, TagCount> = HashMap::new();
    for doc in fs_ops::list_documents(root)? {
        let Some(text) = read_library_text(&doc) else {
            continue;
        };
        for_each_tag(&text, |site| {
            let entry = counts
                .entry(site.tag.tag.to_lowercase())
                .or_insert(TagCount {
                    tag: site.tag.tag,
                    count: 0,
                    paths: Vec::new(),
                });
            entry.count += 1;
            if entry.paths.last() != Some(&doc.path) {
                entry.paths.push(doc.path.clone());
            }
            true
        });
    }
    let mut list: Vec<TagCount> = counts.into_values().collect();
    // 按用到它的文档数排（侧栏显示的就是文档数），再按出现次数、名字
    list.sort_by(|a, b| {
        b.paths
            .len()
            .cmp(&a.paths.len())
            .then_with(|| b.count.cmp(&a.count))
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

    /// 文档里（跳过代码与 HTML 后）的标签：(行号, 标签, UTF-16 起点)
    fn doc_tags(text: &str) -> Vec<(usize, String, usize)> {
        let mut seen = Vec::new();
        for_each_tag(text, |site| {
            seen.push((site.line_number, site.tag.tag, site.utf16_start));
            true
        });
        seen
    }

    fn doc_tag_names(text: &str) -> Vec<String> {
        doc_tags(text).into_iter().map(|(_, tag, _)| tag).collect()
    }

    #[test]
    fn ignores_inline_code() {
        assert_eq!(
            doc_tag_names("`#code` 和 ``#also`` 外面 #real"),
            vec!["real"]
        );
        // 没闭合的反引号不算代码
        assert_eq!(doc_tag_names("` #open"), vec!["open"]);
        // 跨行的行内代码
        assert_eq!(doc_tag_names("`foo\n#multi` 之后 #after"), vec!["after"]);
    }

    #[test]
    fn positions_are_byte_offsets_within_line() {
        let line = "中文 #标签";
        let found = tags_in_line(line);
        assert_eq!(&line[found[0].start..found[0].end], "#标签");
    }

    #[test]
    fn skips_fenced_code_and_reports_utf16_offsets() {
        // "第一行 #a\n" = 6 个 UTF-16 单元 + 换行；"```\n#inside\n```\n" = 16
        assert_eq!(
            doc_tags("第一行 #a\n```\n#inside\n```\n中文 #b"),
            vec![(1, "a".to_string(), 4), (5, "b".to_string(), 7 + 16 + 3)]
        );
    }

    #[test]
    fn skips_code_in_quotes_lists_indented_blocks_and_html() {
        assert!(doc_tag_names("> ```\n> #include x\n> ```").is_empty());
        assert!(doc_tag_names("- a\n  - b\n    ```\n    #nested\n    ```").is_empty());
        assert!(doc_tag_names("- ```\n  #inlist\n  ```").is_empty());
        assert!(doc_tag_names("para\n\n    #indented").is_empty());
        assert!(doc_tag_names("<!-- #comment -->").is_empty());
    }

    #[test]
    fn unclosed_fence_in_list_item_ends_with_the_item() {
        // 列表项里没闭合的代码块到列表项结束为止，后面的标签照常算
        assert_eq!(
            doc_tag_names("- item\n  ```\n  code\n\nlater #after2"),
            vec!["after2"]
        );
        // 信息串里带反引号的不是围栏
        assert_eq!(doc_tag_names("```foo`bar\n#afterweird"), vec!["afterweird"]);
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
        // 每个标签带上用到它的文档：同一篇里出现多次只算一篇
        let work = list_tags(&root)
            .unwrap()
            .into_iter()
            .find(|t| t.tag.eq_ignore_ascii_case("work"))
            .unwrap();
        let mut names: Vec<String> = work
            .paths
            .iter()
            .map(|p| {
                Path::new(p)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        names.sort();
        assert_eq!(names, vec!["a.md", "b.md"]);
        let _ = fs::remove_dir_all(&root);
    }
}
