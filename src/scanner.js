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
  const log = [];
  const t0 = performance.now();
  const ts = () => `${(performance.now() - t0).toFixed(0)}ms`;

  log.push(`[${ts()}] Archivo: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)} KB)`);

  let img;
  try {
    img = await loadImage(file);
    log.push(`[${ts()}] Imagen cargada: ${img.naturalWidth}x${img.naturalHeight}`);
  } catch (err) {
    log.push(`[${ts()}] ERROR cargando imagen: ${err.message}`);
    alert("DEBUG LOG:\n\n" + log.join("\n"));
    throw err;
  }

  const scales = [1, 2, 3];

  if (window.BarcodeDetector) {
    log.push(`[${ts()}] BarcodeDetector nativo disponible`);
    for (const scale of scales) {
      onProgress?.(`Detector nativo (${scale}x)...`);
      const canvas = renderToCanvas(img, scale, false);
      log.push(`[${ts()}] Nativo ${scale}x (${canvas.width}x${canvas.height})...`);
      try {
        const result = await tryNativeDetector(canvas);
        if (result) {
          log.push(`[${ts()}] ENCONTRADO (nativo): "${result.text}" [${result.format}]`);
          alert("DEBUG LOG:\n\n" + log.join("\n"));
          return result;
        }
        log.push(`[${ts()}] Nativo ${scale}x: sin resultado`);
      } catch (err) {
        log.push(`[${ts()}] Nativo ${scale}x ERROR: ${err.message}`);
      }
    }
  } else {
    log.push(`[${ts()}] BarcodeDetector nativo NO disponible`);
  }

  for (const scale of scales) {
    onProgress?.(`ZBar (${scale}x)...`);
    const canvas = renderToCanvas(img, scale, false);
    log.push(`[${ts()}] ZBar ${scale}x (${canvas.width}x${canvas.height})...`);
    try {
      const result = await tryZbar(canvas);
      if (result) {
        log.push(`[${ts()}] ENCONTRADO (zbar): "${result.text}" [${result.format}]`);
        alert("DEBUG LOG:\n\n" + log.join("\n"));
        return result;
      }
      log.push(`[${ts()}] ZBar ${scale}x: sin resultado`);
    } catch (err) {
      log.push(`[${ts()}] ZBar ${scale}x ERROR: ${err.message}`);
    }

    if (scale >= 2) {
      log.push(`[${ts()}] ZBar ${scale}x enhanced...`);
      try {
        const enhanced = renderToCanvas(img, scale, true);
        const enhResult = await tryZbar(enhanced);
        if (enhResult) {
          log.push(`[${ts()}] ENCONTRADO (zbar enhanced): "${enhResult.text}" [${enhResult.format}]`);
          alert("DEBUG LOG:\n\n" + log.join("\n"));
          return enhResult;
        }
        log.push(`[${ts()}] ZBar ${scale}x enhanced: sin resultado`);
      } catch (err) {
        log.push(`[${ts()}] ZBar ${scale}x enhanced ERROR: ${err.message}`);
      }
    }
  }

  const binarizers = ["LocalAverage", "GlobalHistogram", "FixedThreshold"];

  for (const scale of scales) {
    for (const binarizer of binarizers) {
      onProgress?.(`ZXing ${scale}x ${binarizer}...`);
      const canvas = renderToCanvas(img, scale, scale >= 2);
      const imageData = getImageData(canvas);
      log.push(`[${ts()}] ZXing ${scale}x ${binarizer} (${canvas.width}x${canvas.height})...`);
      try {
        const result = await tryZxing(imageData, binarizer, false);
        if (result) {
          log.push(`[${ts()}] ENCONTRADO (zxing ${binarizer}): "${result.text}" [${result.format}]`);
          alert("DEBUG LOG:\n\n" + log.join("\n"));
          return result;
        }
        log.push(`[${ts()}] ZXing ${scale}x ${binarizer}: sin resultado`);
      } catch (err) {
        log.push(`[${ts()}] ZXing ${scale}x ${binarizer} ERROR: ${err.message}`);
      }
    }
  }

  onProgress?.("Lectura tolerante a errores...");
  log.push(`[${ts()}] ZXing tolerante a errores 3x...`);
  try {
    const largeCanvas = renderToCanvas(img, 3, false);
    const partial = await tryZxingWithErrors(getImageData(largeCanvas));
    if (partial) {
      log.push(`[${ts()}] ENCONTRADO (zxing parcial): "${partial.text}" [${partial.format}]`);
      alert("DEBUG LOG:\n\n" + log.join("\n"));
      return partial;
    }
    log.push(`[${ts()}] ZXing tolerante: sin resultado`);
  } catch (err) {
    log.push(`[${ts()}] ZXing tolerante ERROR: ${err.message}`);
  }

  log.push(`[${ts()}] NINGÚN motor pudo decodificar`);
  alert("DEBUG LOG:\n\n" + log.join("\n"));
  return null;
}
