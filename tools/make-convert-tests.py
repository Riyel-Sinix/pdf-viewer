# 生成「转成 PDF」用的测试文件：各种图片（带 EXIF 方向的 JPEG、透明 PNG、WebP、GIF、BMP、多页 TIFF）、
# Markdown、UTF-8 / GBK 文本、CSV、网页（带脚本和自动跳转，用来确认打印时不会执行）、MHT 网页存档、Word、Excel、PowerPoint、加了密码的 docx（只有文件头）。
# 输出到 .cache/test/convert（不进仓库）。python -P tools/make-convert-tests.py [输出目录]
# PowerPoint 的测试文件用本机的 PowerPoint 在后台生成（没装就跳过）。
import io, os, subprocess, sys, textwrap
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache', 'test', 'convert')
PLATES = os.path.join(ROOT, 'src', 'assets', 'plates')
os.makedirs(OUT, exist_ok=True)
P = lambda n: os.path.join(OUT, n)
plate = lambda n: Image.open(os.path.join(PLATES, n)).convert('RGB')

# 1. 手机拍的照片：像素按传感器方向存（横着），EXIF 方向 6 = 要顺时针转 90° 才是正的。转对了应该看到竖着的《The Tyger》
tyger = plate('42.jpg')
stored = tyger.transpose(Image.Transpose.ROTATE_90)          # 逆时针转 90° 存起来
exif = Image.Exif()
exif[0x0112] = 6
stored.save(P('照片-EXIF方向6.jpg'), quality=90, exif=exif, dpi=(72, 72))
# 2. 透明 PNG：中间一个半透明的圆
im = Image.new('RGBA', (900, 600), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.ellipse((150, 50, 750, 550), fill=(63, 111, 149, 200), outline=(43, 35, 29, 255), width=8)
d.text((390, 280), 'PNG alpha', fill=(255, 255, 255, 255))
im.save(P('透明.png'), dpi=(150, 150))
# 3. WebP / GIF / BMP
plate('11.jpg').save(P('The Blossom.webp'), quality=88)
plate('25.jpg').resize((400, 560)).convert('P', palette=Image.Palette.ADAPTIVE).save(P('Infant Joy.gif'))
plate('08.jpg').resize((500, 700)).save(P('The Lamb.bmp'))
# 4. 多页 TIFF：三页「扫描件」，300 dpi，黑白 + 灰度 + 彩色
pages = []
for i, n in enumerate(['04.jpg', '30.jpg', '39.jpg']):
    a4 = Image.new('RGB', (2480, 3508), 'white')
    pl = plate(n)
    pl.thumbnail((2000, 3000))
    a4.paste(pl, ((2480 - pl.width) // 2, 300))
    ImageDraw.Draw(a4).text((240, 3300), f'Scan page {i + 1} / 3', fill='black')
    pages.append(a4.convert('1') if i == 0 else a4.convert('L') if i == 1 else a4)
pages[0].save(P('扫描-三页.tif'), save_all=True, append_images=pages[1:], dpi=(300, 300), compression='tiff_lzw')
# Markdown 里引用的插图
plate('06.jpg').save(P('插图.jpg'), quality=85)

# 5. Markdown（标题会变成 PDF 书签）
md = textwrap.dedent('''\
    # 天真与经验之歌

    威廉·布莱克（William Blake）**1789** 年印行《天真之歌》，*1794* 年合订《经验之歌》，副题是 ~~随便写的~~ “Shewing the Two Contrary States of the Human Soul”。

    ## 目录

    1. 天真之歌（Songs of Innocence）
    2. 经验之歌（Songs of Experience）
       - The Tyger
       - London

    ## 插图

    ![The Ecchoing Green](插图.jpg)

    > Tyger Tyger, burning bright,
    > In the forests of the night;

    ## 表格

    | 卷 | 年份 | 首数 |
    | --- | ---: | ---: |
    | 天真之歌 | 1789 | 19 |
    | 经验之歌 | 1794 | 26 |

    ## 代码

    ```js
    const songs = ['Innocence', 'Experience'];
    console.log(songs.map(s => `Songs of ${s}`).join(' & '));
    ```

    - [x] 能看到插图
    - [ ] 这一项没勾

    行内代码 `printToPDF`，链接 [国会图书馆](https://www.loc.gov/)。生僻字：𠀀𪚥（超出 GB2312）。
    ''')
with open(P('说明.md'), 'w', encoding='utf-8') as f:
    f.write(md)

# 6. 文本：UTF-8 和 GBK 各一份
poem = 'The Tyger\n\nTyger Tyger, burning bright,\nIn the forests of the night;\nWhat immortal hand or eye,\nCould frame thy fearful symmetry?\n\n老虎！老虎！火一样辉煌，\n烧穿了黑夜的森林和草莽，\n什么样非凡的手和眼睛\n能塑造你一身惊人的匀称？\n'
with open(P('诗-UTF8.txt'), 'w', encoding='utf-8') as f:
    f.write(poem * 3)
with open(P('诗-GBK.txt'), 'w', encoding='gbk') as f:
    f.write(poem)
with open(P('代码.py'), 'w', encoding='utf-8') as f:
    f.write('# 一段代码\nimport json\n\n\ndef songs():\n\treturn {"innocence": 1789, "experience": 1794}\n\n\nprint(json.dumps(songs(), ensure_ascii=False, indent=2))\n' + '\n'.join(f'# 第 {i} 行：' + 'x' * (i % 90) for i in range(1, 120)))

# 7. CSV：带 BOM，中文表头，带逗号和换行的引号字段
rows = [['卷', '诗名', '插图编号', '备注']]
for b, t, p in [('天真', 'Introduction', '04'), ('天真', 'The Lamb', '08'), ('经验', 'The Tyger', '42'), ('经验', 'London', '46')]:
    rows.append([b, t, p, '有逗号, 也有"引号"' if t == 'London' else ('第一行\n第二行' if t == 'The Lamb' else '')])
def cell(s):
    return '"' + s.replace('"', '""') + '"' if any(c in s for c in ',"\n') else s
with open(P('目录.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    f.write('\r\n'.join(','.join(cell(c) for c in r) for r in rows) + '\r\n')

# 8. 网页：脚本如果执行了，页面会变成「脚本执行了」；meta refresh 想跳去别的网站——打印出来都不该发生
html = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>网页测试</title>
<meta http-equiv="refresh" content="1;url=https://example.com/">
<style>body{font-family:"Microsoft YaHei",sans-serif;margin:2em}h1{color:#8C4A20}.box{background:#F3E7C9;padding:1em;border-radius:12px}</style>
</head><body>
<h1>网页转 PDF</h1>
<div class="box" id="box">这段文字应该原样印出来（脚本没有执行）。</div>
<h2>第二节</h2>
<p><img src="插图.jpg" width="300" alt="插图"></p>
<script>document.getElementById('box').textContent = '脚本执行了'; document.body.style.background = 'red';</script>
</body></html>'''
with open(P('网页.html'), 'w', encoding='utf-8') as f:
    f.write(html)

# 8b. MHT 网页存档（浏览器「另存为单个文件」）：HTML 和图片都在存档里，图片的网址是假的——印出来有图，说明是从存档里取的。
#     换行必须是 CRLF：Chromium 的 MHTML 解析只认这个（LF 的存档打印出来是一张白纸）
from email import charset as email_charset
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
qp = email_charset.Charset('utf-8')
qp.body_encoding = email_charset.QP
mht = MIMEMultipart('related', type='text/html')
mht['Subject'] = '网页存档'
mht['Snapshot-Content-Location'] = 'http://example.invalid/page.html'
page = MIMEText('''<!doctype html><html><head><meta charset="utf-8"><title>网页存档</title></head>
<body style="font-family:'Microsoft YaHei',sans-serif"><h1>网页存档</h1><p>这是一份 MHT 网页存档，图片在存档里面。</p>
<p><img src="http://example.invalid/tyger.jpg" width="300"></p><h2>存档第二节</h2><p>完。</p></body></html>''', 'html', qp)
page['Content-Location'] = 'http://example.invalid/page.html'
mht.attach(page)
with open(os.path.join(PLATES, '42.jpg'), 'rb') as f:
    pic = MIMEImage(f.read(), 'jpeg')
pic['Content-Location'] = 'http://example.invalid/tyger.jpg'
mht.attach(pic)
with open(P('网页存档.mht'), 'wb') as f:
    f.write(mht.as_bytes(policy=mht.policy.clone(linesep='\r\n')))
# 同一份存档只用 LF 换行（在别的系统上改过的）：程序要先换成 CRLF 再打印
with open(P('网页存档-LF.mht'), 'wb') as f:
    f.write(mht.as_bytes(policy=mht.policy.clone(linesep='\n')))

# 9. Word：标题（会变成书签）、正文、表格、图片
from docx import Document
from docx.shared import Cm
doc = Document()
doc.add_heading('布莱克诗选', 0)
doc.add_heading('天真之歌', 1)
doc.add_paragraph('Piping down the valleys wild, Piping songs of pleasant glee. 吹着牧笛下山谷，吹着欢乐的歌。')
doc.add_picture(os.path.join(PLATES, '04.jpg'), width=Cm(6))
doc.add_heading('经验之歌', 1)
doc.add_heading('The Tyger', 2)
doc.add_paragraph('Tyger Tyger, burning bright, In the forests of the night.')
t = doc.add_table(rows=3, cols=3)
t.style = 'Table Grid'
for r, vals in enumerate([['卷', '年份', '首数'], ['天真之歌', '1789', '19'], ['经验之歌', '1794', '26']]):
    for c, v in enumerate(vals):
        t.cell(r, c).text = v
doc.add_page_break()
doc.add_heading('第二页', 1)
doc.add_paragraph('这是第二页。')
doc.save(P('报告.docx'))

# 10. Excel：两张工作表
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = '诗目'
ws.append(['卷', '诗名', '插图'])
for b, t, p in [('天真', 'Introduction', 4), ('天真', 'The Lamb', 8), ('经验', 'The Tyger', 42)]:
    ws.append([b, t, p])
ws2 = wb.create_sheet('统计')
ws2.append(['卷', '首数'])
ws2.append(['天真之歌', 19])
ws2.append(['经验之歌', 26])
ws2.append(['合计', '=SUM(B2:B3)'])
wb.save(P('表格.xlsx'))

# 11. 加了打开密码的 docx：真的加密文件是 OLE 复合文件，程序只看文件头就会拦下，这里只写个文件头
with open(P('加密.docx'), 'wb') as f:
    f.write(bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + bytes(504))

# 12. PowerPoint：用本机的 PowerPoint 在后台生成两页（没装就跳过）
pptx = P('幻灯片.pptx')
ps = r'''
$ErrorActionPreference = 'Stop'
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Add(0)
$s1 = $pres.Slides.Add(1, 1); $s1.Shapes.Item(1).TextFrame.TextRange.Text = '天真与经验之歌'; $s1.Shapes.Item(2).TextFrame.TextRange.Text = 'William Blake'
$s2 = $pres.Slides.Add(2, 2); $s2.Shapes.Item(1).TextFrame.TextRange.Text = 'The Tyger'; $s2.Shapes.Item(2).TextFrame.TextRange.Text = 'Tyger Tyger, burning bright'
$pres.SaveAs($env:PPTX_OUT, 24)
$pres.Close()
if ($pp.Presentations.Count -eq 0) { $pp.Quit() }
'''
if not os.path.exists(pptx):
    try:
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', ps], env={**os.environ, 'PPTX_OUT': pptx},
                       check=True, timeout=120, creationflags=0x08000000, capture_output=True)
    except Exception as e:
        print('跳过 PowerPoint 测试文件：', e)

for n in sorted(os.listdir(OUT)):
    print(f'{os.path.getsize(P(n)):>10}  {n}')
