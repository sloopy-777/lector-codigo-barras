import "./style.css";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { scanFromFile } from "./scanner";

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector<T>(sel)!;

const btnCamera = $<HTMLButtonElement>("#btn-camera");
const btnFile = $<HTMLButtonElement>("#btn-file");
const cameraContainer = $<HTMLDivElement>("#camera-container");
const fileContainer = $<HTMLDivElement>("#file-container");
const cameraPlaceholder = $<HTMLDivElement>("#camera-placeholder");
const btnStartCamera = $<HTMLButtonElement>("#btn-start-camera");
const fileInput = $<HTMLInputElement>("#file-input");
const dropZone = $<HTMLLabelElement>("#drop-zone");
const filePreview = $<HTMLDivElement>("#file-preview");
const previewImg = $<HTMLImageElement>("#preview-img");
const resultSection = $<HTMLDivElement>("#result-section");
const resultText = $<HTMLParagraphElement>("#result-text");
const btnCopy = $<HTMLButtonElement>("#btn-copy");
const btnOpen = $<HTMLButtonElement>("#btn-open");

const CAMERA_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.AZTEC,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
];

let scanner: Html5Qrcode | null = null;
let cameraRunning = false;

function isUrl(text: string): boolean {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function showResult(text: string, format?: string) {
  resultSection.classList.remove("hidden");
  resultText.textContent = text;

  const formatBadge = document.getElementById("result-format");
  if (formatBadge && format) {
    formatBadge.textContent = format;
    formatBadge.classList.remove("hidden");
  } else if (formatBadge) {
    formatBadge.classList.add("hidden");
  }

  if (isUrl(text)) {
    btnOpen.classList.remove("hidden");
    btnOpen.onclick = () => window.open(text, "_blank", "noopener");
  } else {
    btnOpen.classList.add("hidden");
  }

  resultSection.scrollIntoView({ behavior: "smooth" });
}

function showStatus(msg: string) {
  resultSection.classList.remove("hidden");
  resultText.textContent = msg;
  const formatBadge = document.getElementById("result-format");
  if (formatBadge) formatBadge.classList.add("hidden");
  btnOpen.classList.add("hidden");
}

function setMode(mode: "camera" | "file") {
  if (mode === "camera") {
    btnCamera.classList.add("active");
    btnFile.classList.remove("active");
    cameraContainer.classList.remove("hidden");
    fileContainer.classList.add("hidden");
  } else {
    btnFile.classList.add("active");
    btnCamera.classList.remove("active");
    fileContainer.classList.remove("hidden");
    cameraContainer.classList.add("hidden");
    stopCamera();
  }
}

async function startCamera() {
  if (cameraRunning) return;

  scanner = new Html5Qrcode("reader", {
    formatsToSupport: CAMERA_FORMATS,
    verbose: false,
  });

  cameraPlaceholder.classList.add("hidden");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 280, height: 200 } },
      (decodedText) => {
        showResult(decodedText);
        stopCamera();
      },
      () => {}
    );
    cameraRunning = true;
  } catch (err) {
    console.error("Error al iniciar cámara:", err);
    cameraPlaceholder.classList.remove("hidden");
    cameraPlaceholder.querySelector("p")!.textContent =
      "No se pudo acceder a la cámara. Verifica los permisos.";
  }
}

async function stopCamera() {
  if (scanner && cameraRunning) {
    try {
      await scanner.stop();
    } catch {
      // already stopped
    }
    cameraRunning = false;
  }
}

async function handleFile(file: File) {
  const previewUrl = URL.createObjectURL(file);
  previewImg.src = previewUrl;
  filePreview.classList.remove("hidden");

  showStatus("Analizando imagen...");

  try {
    const result = await scanFromFile(file, (msg) => {
      showStatus(msg);
    });

    if (result) {
      console.log(`Decoded by ${result.engine}:`, result.format);
      showResult(result.text, result.format);
    } else {
      showResult(
        "No se pudo decodificar el código de barras. Intenta con una foto de mejor resolución, bien enfocada y sin inclinación."
      );
    }
  } catch (err) {
    console.error("Error al escanear archivo:", err);
    showResult("Error al procesar la imagen.");
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

// Mode switching
btnCamera.addEventListener("click", () => setMode("camera"));
btnFile.addEventListener("click", () => setMode("file"));

// Camera start
btnStartCamera.addEventListener("click", startCamera);

// File input
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

// Drag & drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith("image/")) {
    handleFile(file);
  }
});

// Copy result
btnCopy.addEventListener("click", async () => {
  const text = resultText.textContent ?? "";
  await navigator.clipboard.writeText(text);
  const original = btnCopy.innerHTML;
  btnCopy.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    Copiado
  `;
  setTimeout(() => {
    btnCopy.innerHTML = original;
  }, 2000);
});

// Register PWA
if ("serviceWorker" in navigator) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
