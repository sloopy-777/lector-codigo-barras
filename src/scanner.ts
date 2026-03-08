import { readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import { BarcodeDetectorPolyfill } from "@undecaf/barcode-detector-polyfill";

export interface ScanResult {
  text: string;
  format: string;
  engine: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
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

function renderToCanvas(
  img: HTMLImageElement,
  scale: number,
  enhance: boolean
): HTMLCanvasElement {
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  if (enhance) {
    ctx.filter = "contrast(1.5) grayscale(1)";
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function getImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

type Binarizer = ReaderOptions["binarizer"];

// Phase 1: Native BarcodeDetector (Chrome/Edge/Android - uses platform ML)
async function tryNativeDetector(
  canvas: HTMLCanvasElement
): Promise<ScanResult | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  if (!win.BarcodeDetector) return null;

  try {
    const NativeDetector = win.BarcodeDetector as typeof BarcodeDetectorPolyfill;
    const detector = new NativeDetector();
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

// Phase 2: ZBar via polyfill
async function tryZbar(
  canvas: HTMLCanvasElement
): Promise<ScanResult | null> {
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

// Phase 3: ZXing WASM
async function tryZxing(
  imageData: ImageData,
  binarizer: Binarizer,
  denoise: boolean
): Promise<ScanResult | null> {
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

// Phase 4: ZXing with error tolerance
async function tryZxingWithErrors(
  imageData: ImageData
): Promise<ScanResult | null> {
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

export async function scanFromFile(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ScanResult | null> {
  const img = await loadImage(file);
  const scales = [1, 2, 3];

  // Phase 1: Native BarcodeDetector (best on Chrome Android/macOS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).BarcodeDetector) {
    for (const scale of scales) {
      onProgress?.(`Detector nativo (${scale}x)...`);
      const canvas = renderToCanvas(img, scale, false);
      const result = await tryNativeDetector(canvas);
      if (result) return result;
    }
  }

  // Phase 2: ZBar
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

  // Phase 3: ZXing
  const binarizers: Binarizer[] = [
    "LocalAverage",
    "GlobalHistogram",
    "FixedThreshold",
  ];

  for (const scale of scales) {
    for (const binarizer of binarizers) {
      onProgress?.(`ZXing ${scale}x ${binarizer}...`);
      const canvas = renderToCanvas(img, scale, scale >= 2);
      const imageData = getImageData(canvas);
      const result = await tryZxing(imageData, binarizer, false);
      if (result) return result;
    }
  }

  // Phase 4: ZXing with error tolerance
  onProgress?.("Lectura tolerante a errores...");
  const largeCanvas = renderToCanvas(img, 3, false);
  const partial = await tryZxingWithErrors(getImageData(largeCanvas));
  if (partial) return partial;

  return null;
}
