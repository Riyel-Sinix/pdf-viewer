# 界面字体子集：霞鹜文楷（GB2312 全部汉字 + 界面里用到的字），IM Fell English 沿用课表站的子集
# 源字体放在 .cache/fonts（LXGW WenKai v1.530，GitHub Releases）；用 python -P tools/fonts.py 运行（fontTools 装在用户 site-packages，-I 会找不到）
# 两套字体都是 SIL OFL 1.1，而且都有保留字体名（「霞鹜」「LXGW」「IM FELL English」…）：子集化后的字体算「修改过的版本」，
# 不能再用这些名字，所以把字体内部的名字改成 Songs Han / Songs Fell（样式表里本来就用这两个名字），版权和许可证信息原样保留。
# 许可证全文在 licenses/ 下
import glob, os
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.cache', 'fonts')
OUT = os.path.join(ROOT, 'src', 'assets', 'fonts')

# 输出文件 → (字体族名, 样式, PostScript 名)
NAMES = {
    'wk-400.woff2': ('Songs Han', 'Regular', 'SongsHan-Regular'),
    'wk-500.woff2': ('Songs Han', 'Medium', 'SongsHan-Medium'),
    'fell-r.woff2': ('Songs Fell', 'Regular', 'SongsFell-Regular'),
    'fell-i.woff2': ('Songs Fell', 'Italic', 'SongsFell-Italic'),
}

def rename(f, out):
    fam, style, ps = NAMES[out]
    ribbi = style in ('Regular', 'Italic', 'Bold', 'Bold Italic')
    legacy = fam if ribbi else f'{fam} {style}'          # 老式（RIBBI）族名：Medium 这种要并进族名里
    full = fam if style == 'Regular' else f'{fam} {style}'
    vals = {1: legacy, 3: f'{ps};subset', 4: full, 6: ps, 16: fam, 18: full, 21: fam}
    n = f['name']
    for r in n.names:
        if r.nameID in vals:
            r.string = vals[r.nameID]
    if not ribbi and not n.getName(16, 3, 1, 0x409):
        n.setName(fam, 16, 3, 1, 0x409)
        n.setName(style, 17, 3, 1, 0x409)

chars = set(chr(c) for c in range(0x20, 0x7f))
for b1 in range(0xA1, 0xF8):            # GB2312：符号区 + 一二级汉字
    for b2 in range(0xA1, 0xFF):
        try:
            chars.add(bytes([b1, b2]).decode('gb2312'))
        except UnicodeDecodeError:
            pass
chars |= set('，。、；：？！“”‘’（）《》【】〔〕—…·％／～　「」『』﹏×÷±≈≠≤≥←→↑↓↻↺✓✗')
for f in glob.glob(os.path.join(ROOT, 'src', '**', '*.*'), recursive=True):
    if os.sep + 'vendor' + os.sep in f or not f.endswith(('.html', '.js', '.css')):
        continue
    chars |= set(open(f, encoding='utf-8').read())
chars = {c for c in chars if c.isprintable() or c == '　'}

def build(src, out):
    f = TTFont(os.path.join(SRC, src))
    o = subset.Options(); o.flavor = 'woff2'; o.layout_features = ['kern', 'liga', 'calt', 'vert', 'vrt2']; o.name_IDs = ['*']; o.notdef_outline = True
    sub = subset.Subsetter(o); sub.populate(text=''.join(sorted(chars))); sub.subset(f)
    rename(f, out)
    f.flavor = 'woff2'; path = os.path.join(OUT, out); f.save(path)
    print(out, len(chars), 'chars', round(os.path.getsize(path) / 1024), 'KB')

build('LXGWWenKai-Regular.ttf', 'wk-400.woff2')
build('LXGWWenKai-Medium.ttf', 'wk-500.woff2')
# Fell 的子集是现成的（课表站那份），只改名
for out in ('fell-r.woff2', 'fell-i.woff2'):
    path = os.path.join(OUT, out)
    f = TTFont(path)
    rename(f, out)
    f.save(path)
    print(out, 'renamed')
