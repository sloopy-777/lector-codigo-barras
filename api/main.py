import zlib
from io import BytesIO

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from pyzbar.pyzbar import decode, ZBarSymbol

app = FastAPI()

SYMBOL_TYPES = [
    ZBarSymbol.PDF417,
    ZBarSymbol.QRCODE,
    ZBarSymbol.CODE128,
    ZBarSymbol.CODE39,
    ZBarSymbol.EAN13,
    ZBarSymbol.EAN8,
    ZBarSymbol.UPCA,
    ZBarSymbol.UPCE,
    ZBarSymbol.I25,
    ZBarSymbol.DATABAR,
    ZBarSymbol.DATABAR_EXP,
    ZBarSymbol.CODE93,
]


def preprocess_variants(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    variants = [img, gray]

    kernel_sharp = np.array([[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]])
    variants.append(cv2.filter2D(gray, -1, kernel_sharp))

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    variants.append(clahe.apply(gray))

    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(otsu)

    for block_size in [15, 31, 51]:
        for c_val in [5, 10, 15]:
            try:
                at = cv2.adaptiveThreshold(
                    gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY, block_size, c_val,
                )
                variants.append(at)
            except Exception:
                pass

    bilateral = cv2.bilateralFilter(gray, 9, 75, 75)
    variants.append(bilateral)
    _, bil_otsu = cv2.threshold(bilateral, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(bil_otsu)

    for scale in [0.5, 1.5, 2.0]:
        h, w = gray.shape[:2]
        scaled = cv2.resize(
            gray, (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_LANCZOS4,
        )
        variants.append(scaled)
        _, s_otsu = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(s_otsu)

    return variants


def try_decompress(data: bytes) -> str | None:
    for wbits in [-15, 15, 31]:
        try:
            text = zlib.decompress(data, wbits).decode("utf-8")
            if len(text) > 10:
                return text
        except Exception:
            pass
    return None


def decode_text(raw: bytes, barcode_type: str) -> str | None:
    if barcode_type == "PDF417":
        decompressed = try_decompress(raw)
        if decompressed:
            return decompressed

    for enc in ("utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            non_printable = sum(
                1 for c in text[:200]
                if ord(c) > 0x7E or (ord(c) < 0x20 and c not in "\n\r\t")
            )
            if non_printable / max(len(text[:200]), 1) < 0.3:
                return text
        except Exception:
            continue

    return None


@app.post("/api/scan")
async def scan_barcode(file: UploadFile = File(...)):
    img_bytes = await file.read()
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return JSONResponse({"text": None, "format": None, "engine": None})

    variants = preprocess_variants(img)

    for variant in variants:
        try:
            results = decode(variant, symbols=SYMBOL_TYPES)
        except Exception:
            continue

        for result in results:
            text = decode_text(result.data, result.type)
            if text and len(text.strip()) > 0:
                return JSONResponse({
                    "text": text,
                    "format": result.type,
                    "engine": "server-pyzbar",
                })

    return JSONResponse({"text": None, "format": None, "engine": None})


@app.get("/api/health")
async def health():
    return {"status": "ok"}
