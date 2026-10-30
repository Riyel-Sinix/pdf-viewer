# 生成截图用的示例 PDF：《天真之歌》《经验之歌》两册选印本——封面 + 6 首诗，每页左边原版插图（Copy Z）、右边诗句，带书签。
# 插图和诗都是公有领域；输出到 .cache/test（不进仓库）。python -P tools/make-showcase-pdf.py [输出目录]
import json, os, re, sys
import pymupdf as fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache', 'test')
PLATES = os.path.join(ROOT, 'src', 'assets', 'plates')
HAN = os.path.join(ROOT, '.cache', 'fonts', 'LXGWWenKai-Regular.ttf')
if not os.path.exists(HAN):
    HAN = r'C:\Windows\Fonts\simkai.ttf'
HAN_FONT = fitz.Font(fontfile=HAN)

src = open(os.path.join(ROOT, 'src', 'js', 'songs.js'), encoding='utf-8').read()
SONGS = json.loads(re.search(r'export default (\[.*\]);?\s*$', src, re.S).group(1))
VOLUMES = [
    # 书, 英文名, 中文名, 封面插图, 选的诗
    ('I', 'Songs of Innocence', '天真之歌', '03.jpg', ['Introduction', 'The Shepherd', 'The Lamb', 'The Blossom', 'The Chimney Sweeper', 'Infant Joy']),
    ('E', 'Songs of Experience', '经验之歌', '30.jpg', ['The Sick Rose', 'The Fly', 'The Tyger', 'London', 'A Poison Tree', 'The Garden of Love']),
]
INK, RUST, FAINT, EDGE = (0.17, 0.14, 0.11), (0.55, 0.30, 0.13), (0.45, 0.38, 0.32), (0.72, 0.62, 0.48)
W, H = 595, 842

def center(p, y, text, font, size, color=INK):
    w = HAN_FONT.text_length(text, fontsize=size) if font == 'han' else fitz.get_text_length(text, fontname=font, fontsize=size)
    p.insert_text(((W - w) / 2, y), text, fontname=font, fontsize=size, color=color)

def plate(p, name, box):
    path = os.path.join(PLATES, name)
    pix = fitz.Pixmap(path)
    s = min(box.width / pix.width, box.height / pix.height)
    w, h = pix.width * s, pix.height * s
    r = fitz.Rect(box.x0 + (box.width - w) / 2, box.y0, box.x0 + (box.width + w) / 2, box.y0 + h)
    p.draw_rect(r + (-4, -4, 4, 4), color=EDGE, width=0.8)
    p.insert_image(r, filename=path)

for book, en, zh, cover, picks in VOLUMES:
    doc = fitz.open()
    def page():
        p = doc.new_page(width=W, height=H)
        p.insert_font(fontname='han', fontfile=HAN)
        return p
    p = page()
    center(p, 92, en.upper(), 'tibo', 30)
    center(p, 122, 'Shewing the Contrary States of the Human Soul', 'tiit', 13, RUST)
    plate(p, cover, fitz.Rect(150, 150, 445, 650))
    center(p, 700, f'{zh}（选）', 'han', 22)
    center(p, 728, 'William Blake · 1794 · Copy Z', 'tiit', 12, FAINT)
    toc = [[1, f'{en}（{zh}）', 1]]
    for i, title in enumerate(picks):
        s = next(x for x in SONGS if x['b'] == book and x['t'] == title)
        p = page()
        center(p, 48, f'{en.upper()}  ·  {zh}', 'han', 9.5, FAINT)
        p.draw_line((60, 60), (W - 60, 60), color=EDGE, width=0.6)
        center(p, 100, s['t'], 'tibo', 26)
        plate(p, f"{s['p']}.jpg", fitz.Rect(48, 128, 290, 760))
        lines = sum(len(st) for st in s['st']) + len(s['st']) - 1
        size = min(12, max(8.5, 560 / (lines * 1.45)))
        y = 150
        for st in s['st']:
            for line in st:
                p.insert_text((312, y), line, fontname='tiro', fontsize=size, color=INK)
                y += size * 1.45
            y += size * 0.8
        center(p, 800, f'— {i + 2} —', 'tiro', 10, FAINT)
        toc.append([2, s['t'], i + 2])
    doc.set_toc(toc)
    doc.set_metadata({'title': f'{en}（{zh}，选）', 'author': 'William Blake', 'subject': '截图用示例：原版插图（Copy Z）与诗句，公有领域', 'creator': 'make-showcase-pdf.py'})
    doc.subset_fonts()
    path = os.path.join(OUT, f'{en}.pdf')
    os.makedirs(OUT, exist_ok=True)
    doc.save(path, garbage=3, deflate=True)
    print(path, doc.page_count, 'pages', round(os.path.getsize(path) / 1024), 'KB')
