import { readBarcodes } from "zxing-wasm/reader";
import { BarcodeDetectorPolyfill } from "@undecaf/barcode-detector-polyfill";

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen"));
    };
    img.src = url;
  });
}

function renderToCanvas(img, scale, enhance) {
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (enhance) {
    ctx.filter = "contrast(1.5) grayscale(1)";
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function getImageData(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function getScales(img) {
  const minDim = Math.min(img.naturalWidth, img.naturalHeight);
  if (minDim >= 1000) return [1, 0.5];
  if (minDim >= 500) return [1, 2];
  return [1, 2, 3];
}

// ── Decompression for PDF417 with compressed data (e.g. Chilean SII) ──

function looksLikeBinary(text) {
  let nonPrintable = 0;
  const len = Math.min(text.length, 200);
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7e || (c < 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09)) {
      nonPrintable++;
    }
  }
  return nonPrintable / len > 0.3;
}

async function tryDecompress(bytes) {
  for (const method of ["deflate-raw", "deflate", "gzip"]) {
    try {
      const ds = new DecompressionStream(method);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      writer.write(bytes);
      writer.close();

      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLen = chunks.reduce((a, c) => a + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) {
        combined.set(c, off);
        off += c.length;
      }

      const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
      if (text.length > 10) return text;
    } catch {
      // try next method
    }
  }
  return null;
}

async function postProcess(result) {
  if (!result || !looksLikeBinary(result.text)) return result;

  if (result.bytes && result.bytes.length > 0) {
    const decompressed = await tryDecompress(result.bytes);
    if (decompressed) {
      return { ...result, text: decompressed };
    }
  }

  // Binary-looking text without raw bytes (native/ZBar) is unusable — skip it
  // so the pipeline falls through to ZXing which provides raw bytes.
  if (!result.bytes || result.bytes.length === 0) {
    return null;
  }

  return result;
}

// ── Scan engines ──

async function tryNativeDetector(canvas) {
  if (!window.BarcodeDetector) return null;

  try {
    const detector = new window.BarcodeDetector();
    const results = await detector.detect(canvas);
    if (results.length > 0 && results[0].rawValue) {
      return {
        text: results[0].rawValue,
        format: results[0].format,
        engine: "nativo",
      };
    }
  } catch {
    // Not supported or failed
  }
  return null;
}

async function tryZbar(canvas) {
  try {
    const detector = new BarcodeDetectorPolyfill();
    const results = await detector.detect(canvas);
    if (results.length > 0 && results[0].rawValue) {
      return {
        text: results[0].rawValue,
        format: results[0].format,
        engine: "zbar",
      };
    }
  } catch (err) {
    console.warn("ZBar error:", err);
  }
  return null;
}

async function tryZxing(imageData, binarizer, denoise) {
  const results = await readBarcodes(imageData, {
    formats: [],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    tryDenoise: denoise,
    binarizer,
    maxNumberOfSymbols: 5,
  });

  if (results.length > 0 && results[0].text) {
    return {
      text: results[0].text,
      bytes: results[0].bytes,
      format: results[0].format,
      engine: "zxing",
    };
  }
  return null;
}

async function tryZxingWithErrors(imageData) {
  const results = await readBarcodes(imageData, {
    formats: [],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    tryDenoise: true,
    returnErrors: true,
    maxNumberOfSymbols: 10,
  });

  const withText = results.filter((r) => r.text && r.text.length > 0);
  if (withText.length > 0) {
    return {
      text: withText[0].text,
      bytes: withText[0].bytes,
      format: withText[0].format + " (parcial)",
      engine: "zxing",
    };
  }
  return null;
}

// ── Main scan pipeline ──

export async function scanFromFile(file, onProgress) {
  const img = await loadImage(file);
  const scales = getScales(img);

  // Phase 1: Native BarcodeDetector
  if (window.BarcodeDetector) {
    for (const scale of scales) {
      onProgress?.(`Detector nativo (${scale}x)...`);
      const canvas = renderToCanvas(img, scale, false);
      const result = await postProcess(await tryNativeDetector(canvas));
      if (result) return result;
    }
  }

  // Phase 2: ZBar
  for (const scale of scales) {
    onProgress?.(`ZBar (${scale}x)...`);
    const canvas = renderToCanvas(img, scale, false);
    const result = await postProcess(await tryZbar(canvas));
    if (result) return result;

    onProgress?.(`ZBar enhanced (${scale}x)...`);
    const enhanced = renderToCanvas(img, scale, true);
    const enhResult = await postProcess(await tryZbar(enhanced));
    if (enhResult) return enhResult;
  }

  // Phase 3: ZXing
  const binarizers = ["LocalAverage", "GlobalHistogram", "FixedThreshold"];

  for (const scale of scales) {
    for (const binarizer of binarizers) {
      for (const denoise of [false, true]) {
        onProgress?.(`ZXing ${scale}x ${binarizer}${denoise ? " +denoise" : ""}...`);
        const canvas = renderToCanvas(img, scale, false);
        const imageData = getImageData(canvas);
        const result = await postProcess(await tryZxing(imageData, binarizer, denoise));
        if (result) return result;
      }
    }
  }

  // Phase 3b: ZXing with enhancement
  for (const scale of scales) {
    onProgress?.(`ZXing enhanced (${scale}x)...`);
    const canvas = renderToCanvas(img, scale, true);
    const imageData = getImageData(canvas);
    const result = await postProcess(await tryZxing(imageData, "LocalAverage", true));
    if (result) return result;
  }

  // Phase 4: ZXing with error tolerance
  onProgress?.("Lectura tolerante a errores...");
  const canvas1x = renderToCanvas(img, 1, false);
  const partial = await postProcess(await tryZxingWithErrors(getImageData(canvas1x)));
  if (partial) return partial;

  // Phase 5: Server-side scanning (pyzbar + OpenCV)
  onProgress?.("Enviando al servidor...");
  const serverResult = await tryServerScan(file);
  if (serverResult) return serverResult;

  return null;
}

async function tryServerScan(file) {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch("/api/scan", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    if (data.text) {
      return { text: data.text, format: data.format, engine: data.engine };
    }
  } catch {
    // Server unavailable — skip silently
  }
  return null;
}
