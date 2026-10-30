# 生成测试用 PDF（.cache/test/F-命名目标.pdf）：嵌套书签，含两种命名目标（/Names 名字树、老式 /Dests 字典）、GoTo 动作、网址书签、展开 / 收起
#   python -P tools/make-named-dests.py ".cache/test/F-命名目标.pdf"
import pymupdf as fitz, sys
out = sys.argv[1]
d = fitz.open()
for i in range(4):
    p = d.new_page(width=595, height=842)
    p.insert_text((72, 100), f'Named dests test - page {i + 1}', fontsize=28)
d.set_toc([
    [1, 'Part A', 1], [2, 'A.1 named-tree', 2], [2, 'A.2 old-dests', 3],
    [1, 'Part B', 3], [2, 'B.1 goto-action', 4],
    [1, 'Website', 0],
])
pref = [d[i].xref for i in range(4)]
items = {}
x = d.xref_get_key(d.pdf_catalog(), 'Outlines')[1]
def walk(xref):
    while xref:
        t = d.xref_get_key(xref, 'Title')[1]
        items[t] = xref
        f = d.xref_get_key(xref, 'First')
        if f[0] == 'xref': walk(int(f[1].split()[0]))
        n = d.xref_get_key(xref, 'Next')
        xref = int(n[1].split()[0]) if n[0] == 'xref' else 0
walk(int(d.xref_get_key(int(x.split()[0]), 'First')[1].split()[0]))
def clear(x):
    d.xref_set_key(x, 'Dest', 'null'); d.xref_set_key(x, 'A', 'null')
for t, x in items.items():
    if t.startswith('A.1'): clear(x); d.xref_set_key(x, 'Dest', '(nd_a1)')
    if t.startswith('A.2'): clear(x); d.xref_set_key(x, 'A', '<</S/GoTo/D/nd_a2>>')
    if t.startswith('B.1'): clear(x); d.xref_set_key(x, 'A', f'<</S/GoTo/D[{pref[3]} 0 R/Fit]>>')
    if t == 'Website': clear(x); d.xref_set_key(x, 'A', '<</S/URI/URI(https://example.org/)>>')
    if t == 'Part B': d.xref_set_key(x, 'Count', str(-abs(int(d.xref_get_key(x, 'Count')[1] or 1))))
cat = d.pdf_catalog()
d.xref_set_key(cat, 'Names', f'<</Dests<</Names[(nd_a1)[{pref[1]} 0 R/Fit]]>>>>')
d.xref_set_key(cat, 'Dests', f'<</nd_a2[{pref[2]} 0 R/XYZ 0 800 0]>>')
d.save(out, garbage=1)
c = fitz.open(out)
for t in c.get_toc(simple=False): print(t[0], t[1], t[2], t[3].get('kind'), t[3].get('collapse'))
