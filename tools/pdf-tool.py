"""
Strumenti PDF di LocalAI: unione e riduzione del peso. Gira con il Python del venv dell'OCR
(C:\\AI\\ocr\\venv), che ha già pikepdf e Pillow perché li usa ocrmypdf.

  python pdf-tool.py merge  <uscita.pdf> <a.pdf> <b.pdf> ...
  python pdf-tool.py compress <uscita.pdf> <ingresso.pdf> [--dpi 200] [--quality 75]

Riduzione: le immagini delle pagine (le scansioni) si portano a <dpi> e si ricomprimono in JPEG <quality>,
a colori. Testo, grafica vettoriale e strato OCR restano come sono. Prova sul PC 2026-11-04 (file di Carla):
200 dpi + JPEG 75 = -62% del peso, firme e loghi senza differenze visibili (SSIM 0,991-0,995).
Stampa su stdout una riga JSON con il risultato.
"""
import io
import warnings
import json
import sys
import zlib

import pikepdf
from pikepdf import Name, PdfImage
from PIL import Image

warnings.filterwarnings("ignore", category=DeprecationWarning)


def merge(out, inputs):
    pdf = pikepdf.new()
    pages = 0
    for path in inputs:
        with pikepdf.open(path) as src:
            pdf.pages.extend(src.pages)
            pages += len(src.pages)
    pdf.save(out)
    return {"pages": pages, "files": len(inputs)}


def image_scale(page, width):
    """Fattore di riduzione per arrivare a dpi: dalla larghezza in pixel e da quella della pagina (in pollici)."""
    box = page.mediabox
    page_in = abs(float(box[2]) - float(box[0])) / 72.0
    return width / page_in if page_in > 0 else 0


def compress(out, inp, dpi=200, quality=75):
    changed = 0
    with pikepdf.open(inp) as pdf:
        done = set()
        for page in pdf.pages:
            for name, raw in list(page.images.items()):
                key = raw.objgen
                if key in done:
                    continue
                done.add(key)
                try:
                    if raw.get("/ImageMask") or raw.get("/SMask") is not None or raw.get("/Mask") is not None:
                        continue  # maschere e trasparenze: si lasciano come sono
                    img = PdfImage(raw).as_pil_image()
                except Exception:
                    continue
                if img.mode not in ("RGB", "L"):
                    try:
                        img = img.convert("RGB")
                    except Exception:
                        continue
                cur = image_scale(page, img.width)
                if cur > dpi * 1.05:
                    f = dpi / cur
                    img = img.resize((max(1, round(img.width * f)), max(1, round(img.height * f))), Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=quality, optimize=True)
                data = buf.getvalue()
                if len(data) >= len(raw.read_raw_bytes()):
                    continue  # non conviene: resta l'originale
                raw.write(data, filter=Name.DCTDecode)
                raw.Width, raw.Height = img.width, img.height
                raw.ColorSpace = Name.DeviceRGB if img.mode == "RGB" else Name.DeviceGray
                raw.BitsPerComponent = 8
                for k in ("/DecodeParms", "/Decode"):
                    if k in raw:
                        del raw[k]
                changed += 1
        pdf.remove_unreferenced_resources()
        pdf.save(out, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    return {"images": changed}


def main(argv):
    if len(argv) < 3:
        raise SystemExit(__doc__)
    cmd, out = argv[0], argv[1]
    if cmd == "merge":
        res = merge(out, argv[2:])
    elif cmd == "compress":
        rest = argv[2:]
        opts = {"dpi": 200, "quality": 75}
        inp = None
        i = 0
        while i < len(rest):
            if rest[i] in ("--dpi", "--quality"):
                opts[rest[i][2:]] = int(rest[i + 1])
                i += 2
            else:
                inp = rest[i]
                i += 1
        res = compress(out, inp, **opts)
    else:
        raise SystemExit(f"comando sconosciuto: {cmd}")
    print(json.dumps({"ok": True, **res}))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except SystemExit:
        raise
    except Exception as e:  # il messaggio arriva a LocalAI
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
