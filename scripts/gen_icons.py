#!/usr/bin/env python3
"""Generate raster launcher icons (no third-party deps; stdlib zlib only).

Draws the Portal Calendar icon (blue gradient tile + white calendar glyph) and
writes density-specific PNGs into app/res/mipmap-*dpi/{ic_launcher,ic_launcher_round}.png.

Raster (not adaptive/vector) because the Portal "aloha" launcher does not render
adaptive icons; an anydpi-v26 adaptive icon would take precedence on API 29 and
show a blank/old icon. Run after changing the icon design, then rebuild the APK.
"""
import os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "app", "res")

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SS = 3  # supersample factor for anti-aliasing

TOP = (0x4F, 0x9D, 0xFF)
BOT = (0x2B, 0x5F, 0xD6)
HEADER = (0x1E, 0x63, 0xD6)
WHITE = (0xFF, 0xFF, 0xFF)
LINE = (0x4F, 0x9D, 0xFF)

# glyph rects in 108-viewport space: (x0,y0,x1,y1,color), applied in order
RECTS = [
    (28, 40, 80, 82, WHITE),    # body
    (28, 40, 80, 51, HEADER),   # header band
    (39, 33, 44, 46, WHITE),    # ring
    (64, 33, 69, 46, WHITE),    # ring
    (37, 60, 71, 64, LINE),     # agenda line 1
    (37, 69, 59, 73, LINE),     # agenda line 2
]


def render(size, round_icon):
    S = size * SS
    f = S / 108.0
    r = S * 0.23                 # corner radius (rounded square)
    cx = cy = S / 2.0
    rad = S / 2.0
    px = bytearray(4 * S * S)    # RGBA, transparent
    rects = [(x0 * f, y0 * f, x1 * f, y1 * f, c) for (x0, y0, x1, y1, c) in RECTS]
    for y in range(S):
        yc = y + 0.5
        for x in range(S):
            xc = x + 0.5
            if round_icon:
                if (xc - cx) ** 2 + (yc - cy) ** 2 > rad * rad:
                    continue
            else:
                qx = min(max(xc, r), S - r)
                qy = min(max(yc, r), S - r)
                if (xc - qx) ** 2 + (yc - qy) ** 2 > r * r:
                    continue
            t = (xc + yc) / (2.0 * S)
            col = (int(TOP[0] + (BOT[0] - TOP[0]) * t),
                   int(TOP[1] + (BOT[1] - TOP[1]) * t),
                   int(TOP[2] + (BOT[2] - TOP[2]) * t))
            for (x0, y0, x1, y1, c) in rects:
                if x0 <= xc < x1 and y0 <= yc < y1:
                    col = c
            o = 4 * (y * S + x)
            px[o] = col[0]; px[o+1] = col[1]; px[o+2] = col[2]; px[o+3] = 255
    return downsample(px, S, size)


def downsample(px, S, size):
    out = bytearray(4 * size * size)
    n = SS * SS
    for oy in range(size):
        for ox in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    o = 4 * ((oy * SS + dy) * S + (ox * SS + dx))
                    al = px[o+3]
                    r += px[o] * al; g += px[o+1] * al; b += px[o+2] * al; a += al
            oo = 4 * (oy * size + ox)
            if a:
                out[oo] = r // a; out[oo+1] = g // a; out[oo+2] = b // a
            out[oo+3] = a // n
    return out


def write_png(path, rgba, size):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    raw = bytearray()
    stride = 4 * size
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
           chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    for d, size in DENSITIES.items():
        out = os.path.join(RES, "mipmap-" + d)
        os.makedirs(out, exist_ok=True)
        write_png(os.path.join(out, "ic_launcher.png"), render(size, False), size)
        write_png(os.path.join(out, "ic_launcher_round.png"), render(size, True), size)
        print("wrote", out, size)


if __name__ == "__main__":
    main()
