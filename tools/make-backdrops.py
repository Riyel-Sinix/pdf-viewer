"""背景图：把 Chrome 主题 Riyel-Sinix/chrome-blake-theme 的三幅水彩做成查看器的背景（⋯ 菜单 / 首页右下角「背景」）。

    python -P tools/make-backdrops.py [主题的 source 文件夹]     # 默认 D:\\Documents\\NC\\chrome-blake-theme\\source

输出到 src/assets/backdrops/：
    <名字>.jpg     铺满窗口用，长边 2560
    t/<名字>.jpg   选择框里的小图：横幅裁成 16:10 铺满，竖幅高 200（程序里按高度居中摆，两边露出主题的水彩晕染）
"""
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:\Documents\NC\chrome-blake-theme\source"
OUT = os.path.join(ROOT, "src", "assets", "backdrops")

# 名字 → (原图, 四边各裁掉多少像素)。玫瑰那幅四角是白色圆角；竖幅顶上两个角有一点白
PICS = {
    "roses": ("roses-crescent-village.png", 48),
    "lane": ("lane-sheep-church.png", 6),
    "border": ("portrait-border.png", 8),
}
LONG = 2560                # 大图长边：2560 逻辑像素宽的窗口也不用放大
THUMB = (320, 200)         # 选择框里显示成 160×100，按两倍做
JPEG = dict(quality=80, optimize=True, progressive=True, subsampling="4:2:0")


def fit_long(im, n):
    s = n / max(im.size)
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS) if s < 1 else im


def cover(im, size):
    w, h = size
    s = max(w / im.width, h / im.height)
    r = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (r.width - w) // 2, (r.height - h) // 2
    return r.crop((x, y, x + w, y + h))


def thumb(im):
    """选择框小图：横幅裁成 16:10；竖幅只缩到高 200，摆法交给程序（和真正铺上去时一样居中）"""
    if im.width >= im.height:
        return cover(im, THUMB)
    h = THUMB[1]
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def main():
    for d in ("", "t"):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)
    for name, (file, crop) in PICS.items():
        im = Image.open(os.path.join(SRC, file)).convert("RGB")
        im = im.crop((crop, crop, im.width - crop, im.height - crop))
        big = fit_long(im, LONG)
        big.save(os.path.join(OUT, name + ".jpg"), **JPEG)
        thumb(im).save(os.path.join(OUT, "t", name + ".jpg"), **JPEG)
        kb = os.path.getsize(os.path.join(OUT, name + ".jpg")) // 1024
        print(f"{name}: {big.width}×{big.height}，{kb} KB")


if __name__ == "__main__":
    main()
