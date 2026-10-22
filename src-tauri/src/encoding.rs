//! 编码处理（R13 / spec §13）
//!
//! - 读取：UTF-8 优先；BOM 检测（UTF-8/16）；失败时用 chardetng 探测，GBK/GB18030 一次性转 UTF-8
//! - 写入：永远 UTF-8 无 BOM
use std::str;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodingKind {
    Utf8,
    Gbk,
    Unknown,
}

impl EncodingKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            EncodingKind::Utf8 => "utf-8",
            EncodingKind::Gbk => "gbk",
            EncodingKind::Unknown => "unknown",
        }
    }
}

#[derive(Debug)]
pub struct Decoded {
    pub text: String,
    pub kind: EncodingKind,
}

const BINARY_ERROR: &str = "无法识别文件编码";

/// 判断是否像二进制文件（含 NUL 字节）
fn looks_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(4096)];
    sample.contains(&0)
}

/// UTF-16 解码（带 BOM 已被剥除）
fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| {
            if little_endian {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

pub fn decode(bytes: &[u8]) -> Result<Decoded, String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok(Decoded {
            text: String::from_utf8_lossy(&bytes[3..]).into_owned(),
            kind: EncodingKind::Utf8,
        });
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok(Decoded {
            text: decode_utf16(&bytes[2..], true),
            kind: EncodingKind::Unknown,
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok(Decoded {
            text: decode_utf16(&bytes[2..], false),
            kind: EncodingKind::Unknown,
        });
    }

    // 严格 UTF-8
    if let Ok(s) = str::from_utf8(bytes) {
        return Ok(Decoded {
            text: s.to_string(),
            kind: EncodingKind::Utf8,
        });
    }

    if looks_binary(bytes) {
        return Err(BINARY_ERROR.to_string());
    }

    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let (enc, _confident) = detector.guess_assess(None, true);
    let (cow, _, _had_errors) = enc.decode(bytes);
    let text = cow.into_owned();

    // 解码后大量替换字符说明这不是文本文件
    let replacement_ratio = text.chars().filter(|c| *c == '\u{FFFD}').count() as f64
        / (text.chars().count().max(1) as f64);
    if replacement_ratio > 0.05 {
        return Err(BINARY_ERROR.to_string());
    }

    let kind = if enc == encoding_rs::GBK || enc == encoding_rs::GB18030 {
        EncodingKind::Gbk
    } else {
        EncodingKind::Unknown
    };
    Ok(Decoded { text, kind })
}

/// 探测行尾风格（spec §7.2：行尾保持原文件）
pub fn detect_line_ending(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "crlf"
    } else {
        "lf"
    }
}

/// 把内容统一为 LF（编辑器内使用），保存时再转回目标风格
pub fn normalize_to_lf(text: &str) -> String {
    if text.contains("\r\n") {
        text.replace("\r\n", "\n")
    } else {
        text.replace('\r', "\n")
    }
}

/// 把 LF 内容转换为目标行尾风格
pub fn apply_line_ending(text: &str, style: &str) -> String {
    if style == "crlf" {
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plain_utf8() {
        let d = decode("你好".as_bytes()).unwrap();
        assert_eq!(d.kind, EncodingKind::Utf8);
        assert_eq!(d.text, "你好");
    }

    #[test]
    fn decodes_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("hi".as_bytes());
        let d = decode(&bytes).unwrap();
        assert_eq!(d.text, "hi");
        assert_eq!(d.kind, EncodingKind::Utf8);
    }

    #[test]
    fn decodes_gbk() {
        let (cow, _, _) = encoding_rs::GBK.encode("中文测试");
        let d = decode(&cow).unwrap();
        assert_eq!(d.kind, EncodingKind::Gbk);
        assert_eq!(d.text, "中文测试");
    }

    #[test]
    fn rejects_binary() {
        let bytes = vec![0x00, 0x01, 0x02, 0xFF, 0xFE, 0x00];
        assert!(decode(&bytes).is_err());
    }

    #[test]
    fn line_ending_roundtrip() {
        assert_eq!(detect_line_ending("a\r\nb"), "crlf");
        assert_eq!(detect_line_ending("a\nb"), "lf");
        assert_eq!(
            apply_line_ending(&normalize_to_lf("a\r\nb"), "crlf"),
            "a\r\nb"
        );
    }
}
