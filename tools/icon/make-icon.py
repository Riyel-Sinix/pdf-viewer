# 应用图标：布莱克《天真与经验之歌》式的手工上色首字母「P」。
#   python -P tools/icon/make-icon.py
# 1. 从界面字体 IM FELL English（src/assets/fonts/fell-r.woff2）里取出「P」的轮廓，写成两个 SVG：
#    p-blake.svg（描金、朱红水彩、墨线，藤蔓从右下绕上来，顶上一朵花，左上一颗星）和
#    p-blake-small.svg（16–32 像素用：只有字和底，字更大、墨线更粗，细藤蔓缩小了会糊成一片）
# 2. 用无头 Edge 把两个 SVG 各渲染成 1024 像素的 PNG
# 3. npx tauri icon 生成 src-tauri/icons 下的全套图标；再把 icon.ico、32x32.png 换成按尺寸挑图的版本
#    （16、24、32 用简化版，48 以上用完整版），界面里用的 src/assets/icon-*.png 也一起生成
import os, shutil, struct, subprocess, sys
from io import BytesIO
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, 'tools', 'icon')
WORK = os.path.join(ROOT, '.cache', 'icon')
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
os.makedirs(WORK, exist_ok=True)


def glyph_path(height, left, top):
    """「P」的轮廓：高 height、左上角在 (left, top)（SVG 坐标，y 向下）"""
    font = TTFont(os.path.join(ROOT, 'src', 'assets', 'fonts', 'fell-r.woff2'))
    gs = font.getGlyphSet()
    g = gs[font.getBestCmap()[ord('P')]]
    bp = BoundsPen(gs)
    g.draw(bp)
    xmin, ymin, xmax, ymax = bp.bounds
    s = height / (ymax - ymin)
    pen = SVGPathPen(gs, ntos=lambda v: f'{v:.1f}'.rstrip('0').rstrip('.'))
    g.draw(TransformPen(pen, (s, 0, 0, -s, left - xmin * s, top + ymax * s)))
    return pen.getCommands(), (xmax - xmin) * s


# 晨光水彩的底（和以前的书本图标同一套）、纸纹、刻线描边
TILE_DEFS = '''
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B9CFD8"/>
      <stop offset=".34" stop-color="#E4E2C4"/>
      <stop offset=".7" stop-color="#F0DDAE"/>
      <stop offset="1" stop-color="#E7C79E"/>
    </linearGradient>
    <radialGradient id="glow" cx=".3" cy=".1" r=".6">
      <stop offset="0" stop-color="#FFF4C8" stop-opacity=".95"/>
      <stop offset="1" stop-color="#FFF4C8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ink" x1="0" y1="0" x2=".35" y2="1">
      <stop offset="0" stop-color="#C0553A"/>
      <stop offset=".55" stop-color="#9C3F25"/>
      <stop offset="1" stop-color="#7E301C"/>
    </linearGradient>
    <clipPath id="tileClip"><rect x="16" y="16" width="480" height="480" rx="104"/></clipPath>'''

FILTERS = '''
    <!-- 水彩：边缘不齐、颜料深浅不匀 -->
    <filter id="wash" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="3" seed="4" result="n1"/>
      <feDisplacementMap in="SourceGraphic" in2="n1" scale="14" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="2" seed="11" result="n2"/>
      <feColorMatrix in="n2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.05 1.42" result="mask"/>
      <feComposite in="d" in2="mask" operator="in" result="mottle"/>
      <feGaussianBlur in="mottle" stdDeviation="1.1"/>
    </filter>
    <!-- 字的颜料：边缘只轻轻抖一点（字形本来就是手刻的毛边），颜色深浅不匀 -->
    <filter id="tint" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="3" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feTurbulence type="fractalNoise" baseFrequency=".024" numOctaves="2" seed="19" result="n2"/>
      <feColorMatrix in="n2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -.8 1.5" result="mask"/>
      <feComposite in="d" in2="mask" operator="in"/>
    </filter>
    <filter id="gild" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves="3" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="1.2"/>
    </filter>
    <filter id="etch" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="21" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="4.5" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" seed="3" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 .42  0 0 0 0 .32  0 0 0 0 .2  0 0 0 .55 -.1"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>'''


def full_svg():
    d, w = glyph_path(340, 130, 86)          # 字高 340，占底的七成；字身偏左（左边有脚衬线），整体往右挪一点
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <!-- 应用图标（tools/icon/make-icon.py 生成）：布莱克《天真与经验之歌》式的手工上色首字母——IM FELL English 的「P」，描金、朱红水彩、墨线；
       藤蔓从右下绕着字长上来，顶上开一朵花，左上一颗星 -->
  <defs>{FILTERS}{TILE_DEFS}
    <path id="P" d="{d}"/>
  </defs>

  <!-- 底：晨光水彩 + 纸纹 -->
  <g clip-path="url(#tileClip)">
    <rect x="16" y="16" width="480" height="480" fill="url(#tile)"/>
    <rect x="16" y="16" width="480" height="480" fill="url(#glow)"/>
    <g filter="url(#wash)" opacity=".55">
      <ellipse cx="430" cy="90" rx="120" ry="70" fill="#8FB0C9"/>
      <ellipse cx="70" cy="470" rx="140" ry="70" fill="#D79AA2" opacity=".6"/>
      <ellipse cx="460" cy="470" rx="130" ry="60" fill="#9DB46E" opacity=".7"/>
    </g>
    <rect x="16" y="16" width="480" height="480" fill="#000" filter="url(#paper)" opacity=".5"/>
  </g>
  <rect x="18" y="18" width="476" height="476" rx="102" fill="none" stroke="#5A3A24" stroke-opacity=".35" stroke-width="3" filter="url(#etch)"/>

  <!-- 字：外面一圈描金，里面朱红水彩，最后墨线 -->
  <use href="#P" fill="#E9C46A" stroke="#E9C46A" stroke-width="20" stroke-linejoin="round" filter="url(#gild)" opacity=".85"/>
  <use href="#P" fill="#F6E7C2"/>
  <use href="#P" fill="url(#ink)" filter="url(#tint)"/>
  <use href="#P" fill="none" stroke="#3A2214" stroke-width="5.5" stroke-linejoin="round" filter="url(#etch)"/>

  <!-- 藤蔓：从字右脚的衬线上长出来，往右卷一下，再绕过字碗的右边爬上去，在顶上开花 -->
  <g filter="url(#etch)" stroke-linecap="round" fill="none">
    <path d="M300 416C336 424 372 446 404 434C432 424 450 400 440 378C428 346 400 334 404 300C408 266 446 252 444 214C442 178 410 168 414 132C417 106 430 96 424 80" stroke="#5D6F2C" stroke-width="6.5"/>
    <path d="M404 434C424 456 456 462 460 444C463 432 450 428 446 436" stroke="#5D6F2C" stroke-width="4"/>
    <path d="M420 146C448 134 466 152 456 168C448 178 434 170 440 162" stroke="#5D6F2C" stroke-width="3.6"/>
    <g stroke="#3A2A1F" stroke-width="2.4">
      <path d="M350 430c-4 22 8 40 26 40 4-20-8-36-26-40z" fill="#86A44A"/>
      <path d="M438 362c-22-10-44-4-50 14 22 10 42 4 50-14z" fill="#7E9C46"/>
      <path d="M406 298c16-16 40-18 54-6-14 16-38 18-54 6z" fill="#97B058"/>
      <path d="M442 222c-20-12-26-34-14-50 20 10 26 32 14 50z" fill="#7E9C46"/>
      <path d="M414 112c-20-4-34-20-30-38 20 2 32 18 30 38z" fill="#86A44A"/>
    </g>
    <!-- 花 -->
    <g stroke="#3A2A1F" stroke-width="2.2">
      <g fill="#E8A3B0">
        <ellipse cx="424" cy="48" rx="11" ry="16"/>
        <ellipse cx="424" cy="48" rx="11" ry="16" transform="rotate(72 424 64)"/>
        <ellipse cx="424" cy="48" rx="11" ry="16" transform="rotate(144 424 64)"/>
        <ellipse cx="424" cy="48" rx="11" ry="16" transform="rotate(216 424 64)"/>
        <ellipse cx="424" cy="48" rx="11" ry="16" transform="rotate(288 424 64)"/>
      </g>
      <circle cx="424" cy="64" r="8" fill="#E2B54C"/>
    </g>
  </g>
  <!-- 一颗星 -->
  <path d="M82 70l7 18 18 7-18 7-7 18-7-18-18-7 18-7z" fill="#F2C95A" stroke="#4A2216" stroke-width="2.6" stroke-linejoin="round" filter="url(#etch)"/>
</svg>
'''


def small_svg():
    d, w = glyph_path(392, 110, 60)          # 小图标：字更大，墨线更粗，不加水彩、纸纹和藤蔓
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <!-- 应用图标的简化版（tools/icon/make-icon.py 生成），16–32 像素用：底 + 朱红的「P」 -->
  <defs>{TILE_DEFS}
    <path id="P" d="{d}"/>
  </defs>
  <g clip-path="url(#tileClip)">
    <rect x="16" y="16" width="480" height="480" fill="url(#tile)"/>
    <rect x="16" y="16" width="480" height="480" fill="url(#glow)"/>
  </g>
  <rect x="20" y="20" width="472" height="472" rx="100" fill="none" stroke="#5A3A24" stroke-opacity=".55" stroke-width="8"/>
  <use href="#P" fill="url(#ink)" stroke="#3A2214" stroke-width="12" stroke-linejoin="round" paint-order="stroke"/>
</svg>
'''


def render(svg_name, png_path):
    """无头 Edge 把 tools/icon 下的 SVG 画成 1024×1024 的透明底 PNG"""
    html = os.path.join(WORK, 'render-' + svg_name + '.html')
    url = 'file:///' + os.path.join(HERE, svg_name).replace('\\', '/')
    with open(html, 'w', encoding='utf-8') as f:
        f.write(f'<!doctype html><html><head><style>html,body{{margin:0;background:transparent}}img{{display:block;width:1024px;height:1024px}}</style></head><body><img src="{url}"></body></html>')
    profile = os.path.join(WORK, 'edge-profile')
    shutil.rmtree(profile, ignore_errors=True)
    subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', f'--user-data-dir={profile}',
                    '--force-device-scale-factor=1', '--window-size=1024,1024', '--default-background-color=00000000',
                    f'--screenshot={png_path}', 'file:///' + html.replace('\\', '/')], check=True, capture_output=True, timeout=120)
    im = Image.open(png_path)
    assert im.size == (1024, 1024) and im.mode == 'RGBA', (png_path, im.size, im.mode)
    return im.copy()


def scaled(im, size):
    return im.resize((size, size), Image.Resampling.LANCZOS)


def write_ico(path, images):
    """images：{边长: RGBA 图}；每个尺寸存成 PNG（和 tauri icon 生成的一样）"""
    blobs = []
    for size in sorted(images):
        buf = BytesIO()
        images[size].save(buf, 'PNG', optimize=True)
        blobs.append((size, buf.getvalue()))
    out = struct.pack('<HHH', 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    for size, data in blobs:
        out += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, 'wb') as f:
        f.write(out + b''.join(data for _, data in blobs))


def main():
    for name, make in (('p-blake.svg', full_svg), ('p-blake-small.svg', small_svg)):
        with open(os.path.join(HERE, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(make())
    full = render('p-blake.svg', os.path.join(HERE, 'icon-1024.png'))
    small = render('p-blake-small.svg', os.path.join(WORK, 'icon-small-1024.png'))
    if '--svg-only' in sys.argv:
        return
    icons = os.path.join(ROOT, 'src-tauri', 'icons')
    subprocess.run('npx tauri icon tools/icon/icon-1024.png -o src-tauri/icons', shell=True, check=True, cwd=ROOT)
    for extra in ('android', 'ios'):                     # 只做 Windows 版：移动端的图标不要
        shutil.rmtree(os.path.join(icons, extra), ignore_errors=True)
    pick = lambda s: scaled(small if s <= 32 else full, s)
    write_ico(os.path.join(icons, 'icon.ico'), {s: pick(s) for s in (16, 24, 32, 48, 64, 256)})
    pick(32).save(os.path.join(icons, '32x32.png'), optimize=True)
    for s in (32, 64):                                    # 网页图标、标题栏左上角（显示 24 像素）
        scaled(small, s).save(os.path.join(ROOT, 'src', 'assets', f'icon-{s}.png'), optimize=True)
    scaled(full, 128).save(os.path.join(ROOT, 'src', 'assets', 'icon-128.png'), optimize=True)
    print('done')


if __name__ == '__main__':
    main()
