#!/usr/bin/env python3
"""生成测试夹具（spec §19.3）。

用法：python3 scripts/generate-fixtures.py
"""
import os
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FIXTURES = os.path.join(ROOT, 'fixtures')


def ensure_dir():
    os.makedirs(FIXTURES, exist_ok=True)


def write_gbk():
    text = "# GBK 文档\n\n这段文字使用 GBK 编码保存，打开时应自动转为 UTF-8。\n".encode('gbk')
    with open(os.path.join(FIXTURES, 'gbk.md'), 'wb') as f:
        f.write(text)


def write_fake_binary():
    with zipfile.ZipFile(os.path.join(FIXTURES, 'fake-md.md'), 'w') as z:
        z.writestr('hello.txt', 'not a markdown file')


def write_large(name, target_bytes):
    paragraph = '这是一段用于性能测试的中文段落，包含标点符号与 English words。\n\n'
    path = os.path.join(FIXTURES, name)
    written = 0
    index = 0
    with open(path, 'w', encoding='utf-8') as f:
        while written < target_bytes:
            block = f'## 小节 {index}\n\n{paragraph * 40}'
            f.write(block)
            written += len(block.encode('utf-8'))
            index += 1


def main():
    ensure_dir()
    write_gbk()
    write_fake_binary()
    write_large('large-1mb.md', 1024 * 1024)
    write_large('large-10mb.md', 10 * 1024 * 1024)
    print('夹具已生成：', FIXTURES)


if __name__ == '__main__':
    main()
