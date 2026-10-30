# 生成测试用 PDF（中英文、目录书签、链接、加密），输出到 .cache/test
import os, sys
import pymupdf as fitz

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache', 'test')
os.makedirs(OUT, exist_ok=True)
FONT = r'C:\Windows\Fonts\simkai.ttf'

def make(name, title, pages, toc=True, encrypt=None, user_pw='', landscape=False):
    doc = fitz.open()
    for i in range(pages):
        w, h = (842, 595) if landscape and i % 2 else (595, 842)
        p = doc.new_page(width=w, height=h)
        p.insert_font(fontname='kai', fontfile=FONT)
        p.insert_text((72, 100), f'{title} · 第 {i + 1} 页', fontname='kai', fontsize=26)
        p.insert_text((72, 140), f'{title} page {i + 1} of {pages}', fontsize=14)
        p.insert_text((72, 170), '天真之歌 Songs of Innocence — 经验之歌 Songs of Experience', fontname='kai', fontsize=13)
        p.draw_rect(fitz.Rect(72, 200, w - 72, h - 120), color=(0.6, 0.3, 0.15), width=1.5)
        for k in range(8):
            p.insert_text((90, 240 + k * 28), f'第 {k + 1} 行：Tyger Tyger, burning bright, 老虎 老虎 {i + 1}-{k + 1}', fontname='kai', fontsize=12)
    for i, p in enumerate(doc):   # 链接要等所有页都建好再加
        w, h = p.rect.width, p.rect.height
        if i + 1 < pages:
            p.insert_link({'kind': fitz.LINK_GOTO, 'from': fitz.Rect(72, h - 100, 300, h - 80), 'page': i + 1})
            p.insert_text((72, h - 85), '→ 下一页（内部链接）', fontname='kai', fontsize=12, color=(0.2, 0.3, 0.7))
        p.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(330, h - 100, w - 72, h - 80), 'uri': 'https://www.loc.gov/item/2003660393/'})
        p.insert_text((330, h - 85), 'loc.gov（外部链接）', fontname='kai', fontsize=12, color=(0.2, 0.3, 0.7))
    if toc:
        doc.set_toc([[1, f'{title} 开始', 1]] + [[2, f'第 {i + 1} 页', i + 1] for i in range(pages)])
    doc.set_metadata({'title': title, 'author': 'Test', 'subject': '测试文件', 'creator': 'make-test-pdfs.py'})
    doc.subset_fonts()
    path = os.path.join(OUT, name)
    if encrypt:
        doc.save(path, encryption=encrypt, owner_pw='owner-secret', user_pw=user_pw, permissions=fitz.PDF_PERM_PRINT, garbage=3, deflate=True)
    else:
        doc.save(path, garbage=3, deflate=True)
    print(name, pages, 'pages', os.path.getsize(path), 'bytes')

make('A-天真.pdf', '天真之歌', 3)
make('B-经验-仅所有者密码.pdf', '经验之歌', 2, encrypt=fitz.PDF_ENCRYPT_AES_256)
make('C-用户密码123.pdf', '有密码的书', 2, encrypt=fitz.PDF_ENCRYPT_AES_128, user_pw='123')
make('D-横竖混排.pdf', '横竖混排', 4, landscape=True, toc=False)
