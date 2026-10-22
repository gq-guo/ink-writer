//! 夹具用例（spec §19.3）
//!
//! 覆盖：GBK 解码、CRLF 行尾、二进制伪装拒绝、H1 标题提取。

use std::path::PathBuf;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("fixtures")
        .join(name)
}

#[test]
fn reads_gbk_fixture() {
    let path = fixture("gbk.md");
    let result = ink_writer_lib::testing::read_document(&path).expect("应当能读取 GBK 文件");
    assert_eq!(result.encoding, "gbk");
    assert!(result.content.contains("GBK"));
}

#[test]
fn rejects_binary_disguised_as_markdown() {
    let path = fixture("fake-md.md");
    let result = ink_writer_lib::testing::read_document(&path);
    assert!(result.is_err(), "二进制伪装文件应当被拒绝");
}

#[test]
fn detects_crlf_line_endings() {
    let path = fixture("crlf.md");
    let result = ink_writer_lib::testing::read_document(&path).expect("应当能读取 CRLF 文件");
    assert_eq!(result.line_ending, "crlf");
    assert!(!result.content.contains('\r'), "编辑器内统一使用 LF");
}

#[test]
fn extracts_h1_as_display_title() {
    let path = fixture("basic.md");
    let meta = ink_writer_lib::testing::meta_for_testing(&path);
    assert_eq!(meta.display_title, "Ink 写作示例");
}

#[test]
fn falls_back_to_file_name_without_h1() {
    let path = fixture("no-h1.md");
    let meta = ink_writer_lib::testing::meta_for_testing(&path);
    assert_eq!(meta.display_title, "no-h1");
}

#[test]
fn gbk_fixture_is_converted_to_utf8_on_write() {
    let dir = std::env::temp_dir().join(format!("ink-gbk-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("gbk-copy.md");

    let source = ink_writer_lib::testing::read_document(&fixture("gbk.md")).unwrap();
    ink_writer_lib::testing::write_document(&target, &source.content, None).unwrap();

    let written = std::fs::read(&target).unwrap();
    assert!(
        std::str::from_utf8(&written).is_ok(),
        "写出的文件必须是 UTF-8"
    );
    assert!(
        !written.starts_with(&[0xEF, 0xBB, 0xBF]),
        "写出的文件不能有 BOM"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
