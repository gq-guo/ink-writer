"""把官方字体子集化成 woff2，输出到 src/fonts。

来源（均为 SIL OFL）：
- Noto Serif SC：github.com/notofonts/noto-cjk  Serif/SubsetOTF/SC（Regular / Bold）
- 霞鹜文楷：github.com/lxgw/LxgwWenKai  releases（Regular / Medium）
- Source Serif 4：github.com/adobe-fonts/source-serif  releases 的 WOFF2 包（解压到 <源目录>/ss/）
- 字表：unicode.org Unihan.zip 的 kTGHZ2013 字段（《通用规范汉字表》8105 字）

依赖：pip install fonttools brotli
用法：python -I scripts/subset-fonts.py <源目录> <Unihan 解压目录> src/fonts [--latin-only]
"""
import sys
from pathlib import Path

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

src, unihan, out = (Path(p).resolve() for p in sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)

# 《通用规范汉字表》8105 字：Unihan 的 kTGHZ2013 字段
hanzi = set()
for line in (unihan / 'Unihan_Readings.txt').read_text(encoding='utf-8').splitlines():
    parts = line.split('\t')
    if len(parts) >= 2 and parts[0].startswith('U+') and parts[1] == 'kTGHZ2013':
        hanzi.add(int(parts[0][2:], 16))
assert len(hanzi) == 8105, len(hanzi)


def span(a, b):
    return set(range(a, b + 1))


LATIN = span(0x20, 0x7E) | span(0xA0, 0x17F) | span(0x2000, 0x206F) | {0x20AC, 0x2122, 0x2190, 0x2192, 0x2026}
CJK_PUNCT = span(0x3000, 0x303F) | span(0xFF00, 0xFFEF) | span(0xFE10, 0xFE1F) | {0x00B7, 0x2014, 0x2015, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026}


def subset(source, target, codepoints, rename=None):
    font = TTFont(source)
    options = Options()
    options.flavor = 'woff2'
    options.hinting = False
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.notdef_outline = True
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    if rename:
        # OFL 保留名（Reserved Font Name）：修改版不得沿用原名
        family, style = rename
        name = font['name']
        for record in list(name.names):
            if record.nameID in (1, 3, 4, 6, 16, 17, 21, 22):
                name.removeNames(nameID=record.nameID)
        name.setName(family, 1, 3, 1, 0x409)
        name.setName(style, 2, 3, 1, 0x409)
        name.setName(f'{family} {style}', 4, 3, 1, 0x409)
        name.setName(f'{family.replace(" ", "")}-{style.replace(" ", "")}', 6, 3, 1, 0x409)
        name.setName(f'{family};{style}', 3, 3, 1, 0x409)
    font.flavor = 'woff2'
    font.save(target)
    print(f'{target.name:32} {target.stat().st_size / 1024 / 1024:6.2f} MB')


cjk = hanzi | CJK_PUNCT | LATIN
if '--latin-only' not in sys.argv:
    subset(src / 'NotoSerifSC-Regular.otf', out / 'noto-serif-sc-Regular.woff2', cjk)
    subset(src / 'NotoSerifSC-Bold.otf', out / 'noto-serif-sc-Bold.woff2', cjk)
    subset(src / 'LXGWWenKai-Regular.ttf', out / 'lxgw-wenkai-Regular.woff2', cjk)
    subset(src / 'LXGWWenKai-Medium.ttf', out / 'lxgw-wenkai-Medium.woff2', cjk)

serif_dir = next(src.glob('ss/*/OTF'))
for style, file in [('Regular', 'Regular'), ('Italic', 'It'), ('Bold', 'Bold'), ('Bold Italic', 'BoldIt')]:
    subset(
        serif_dir / f'SourceSerif4-{file}.otf.woff2',
        out / f'ink-serif-text-{style.replace(" ", "")}.woff2',
        LATIN,
        rename=('Ink Serif Text', style),
    )
