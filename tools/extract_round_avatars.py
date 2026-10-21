#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Cut the 25 round cartoon avatars out of the supplied EPS sheet.

The EPS is vector art, so it is rasterised once at high resolution
(Ghostscript -> one cropped page PDF -> PyMuPDF raster) and then sliced into
25 square PNGs. Each PNG keeps the coloured disc and drops the white sheet
behind it, so the corners are transparent and the file can sit in a round
avatar slot.

    python tools/extract_round_avatars.py "<path to avatars_round_25_color.eps>"
"""
import io
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "avatars")
SIZE = 128
COLS = ROWS = 5
GS = r"C:\Program Files\gs\gs10.08.0\bin\gswin64c.exe"


def rasterise(eps_path, px=4000):
    """EPS -> cropped one page PDF (Ghostscript) -> RGBA raster (PyMuPDF)."""
    import pymupdf
    tmp = os.environ.get("TEMP", ".")
    pdf = os.path.join(tmp, "avatar_sheet.pdf")
    subprocess.check_call([
        GS, "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dEPSCrop",
        "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.7",
        "-sOutputFile=" + pdf, eps_path,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    doc = pymupdf.open(pdf)
    page = doc[0]
    zoom = px / max(page.rect.width, page.rect.height)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
    img = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    doc.close()
    return img


def find_discs(sheet):
    """Locate the coloured discs: connected components that are not white."""
    a = np.asarray(sheet)
    rgb = a[..., :3].astype(np.int32)
    content = (rgb.sum(axis=2) < 255 * 3 - 25)
    labels, n = ndimage.label(content)
    objs = ndimage.find_objects(labels)
    boxes = []
    for i, sl in enumerate(objs):
        if sl is None:
            continue
        area = int((labels[sl] == (i + 1)).sum())
        if area < (sheet.width * sheet.height) * 0.0015:
            continue
        boxes.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    return boxes


def cut(sheet, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    side = max(w, h) + 4
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    left, top = int(round(cx - side / 2)), int(round(cy - side / 2))
    right, bottom = left + side, top + side
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(sheet.crop((left, top, right, bottom)), (0, 0))
    out = out.resize((SIZE, SIZE), Image.LANCZOS)
    # hard round mask, a hair smaller so no white fringe survives
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    d = np.sqrt((xx - SIZE / 2.0 + 0.5) ** 2 + (yy - SIZE / 2.0 + 0.5) ** 2)
    mask = np.clip((SIZE / 2.0 - 1.5 - d) * 255.0, 0, 255).astype(np.uint8)
    alpha = np.minimum(np.asarray(out.getchannel("A")), mask)
    out.putalpha(Image.fromarray(alpha, "L"))
    return out


def main():
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        print("usage: python tools/extract_round_avatars.py <file.eps>")
        return 1
    os.makedirs(OUT, exist_ok=True)
    sheet = rasterise(sys.argv[1])
    print("sheet rasterised:", sheet.size)
    boxes = find_discs(sheet)
    print("discs found:", len(boxes))
    # reading order: top to bottom, then left to right
    boxes.sort(key=lambda b: (round(b[1] / 100.0), b[0]))
    for idx, box in enumerate(boxes, start=1):
        disc = cut(sheet, box)
        flat = disc.convert("RGB").quantize(colors=160, method=Image.MEDIANCUT).convert("RGBA")
        flat.putalpha(disc.getchannel("A"))
        path = os.path.join(OUT, "person-%02d.png" % idx)
        flat.save(path, "PNG", optimize=True)
        print("person-%02d.png  %6d bytes  box=%s" % (idx, os.path.getsize(path), box))
    return 0


if __name__ == "__main__":
    sys.exit(main())
