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
    tryDownscale: false,
    tryDenoise: denoise,
    binarizer,
    maxNumberOfSymbols: 5,
  });

  if (results.length > 0 && results[0].text) {
    return {
      text: results[0].text,
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
    tryDownscale: false,
    tryDenoise: true,
    returnErrors: true,
    maxNumberOfSymbols: 10,
  });

  const withText = results.filter((r) => r.text && r.text.length > 0);
  if (withText.length > 0) {
    return {
      text: withText[0].text,
      format: withText[0].format + " (parcial)",
      engine: "zxing",
    };
  }
  return null;
}

export async function scanFromFile(file, onProgress) {
  const img = await loadImage(file);
  const scales = [1, 2, 3];

  if (window.BarcodeDetector) {
    for (const scale of scales) {
      onProgress?.(`Detector nativo (${scale}x)...`);
      const canvas = renderToCanvas(img, scale, false);
      const result = await tryNativeDetector(canvas);
      if (result) return result;
    }
  }

  for (const scale of scales) {
    onProgress?.(`ZBar (${scale}x)...`);
    const canvas = renderToCanvas(img, scale, false);
    const result = await tryZbar(canvas);
    if (result) return result;

    if (scale >= 2) {
      const enhanced = renderToCanvas(img, scale, true);
      const enhResult = await tryZbar(enhanced);
      if (enhResult) return enhResult;
    }
  }

  const binarizers = ["LocalAverage", "GlobalHistogram", "FixedThreshold"];

  for (const scale of scales) {
    for (const binarizer of binarizers) {
      onProgress?.(`ZXing ${scale}x ${binarizer}...`);
      const canvas = renderToCanvas(img, scale, scale >= 2);
      const imageData = getImageData(canvas);
      const result = await tryZxing(imageData, binarizer, false);
      if (result) return result;
    }
  }

  onProgress?.("Lectura tolerante a errores...");
  const largeCanvas = renderToCanvas(img, 3, false);
  const partial = await tryZxingWithErrors(getImageData(largeCanvas));
  if (partial) return partial;

  return null;
}
