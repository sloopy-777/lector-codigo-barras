import "./style.css";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { scanFromFile } from "./scanner";

const $ = (sel) => document.querySelector(sel);

const btnCamera = $("#btn-camera");
const btnFile = $("#btn-file");
const cameraContainer = $("#camera-container");
const fileContainer = $("#file-container");
const cameraPlaceholder = $("#camera-placeholder");
const btnStartCamera = $("#btn-start-camera");
const fileInput = $("#file-input");
const dropZone = $("#drop-zone");
const filePreview = $("#file-preview");
const previewImg = $("#preview-img");
const resultSection = $("#result-section");
const resultText = $("#result-text");
const btnCopy = $("#btn-copy");
const btnOpen = $("#btn-open");

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

let scanner = null;
let cameraRunning = false;

function isUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function showResult(text, format) {
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

function showStatus(msg) {
  resultSection.classList.remove("hidden");
  resultText.textContent = msg;
  const formatBadge = document.getElementById("result-format");
  if (formatBadge) formatBadge.classList.add("hidden");
  btnOpen.classList.add("hidden");
}

function setMode(mode) {
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
    cameraPlaceholder.querySelector("p").textContent =
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

async function handleFile(file) {
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

btnCamera.addEventListener("click", () => setMode("camera"));
btnFile.addEventListener("click", () => setMode("file"));

btnStartCamera.addEventListener("click", startCamera);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

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

if ("serviceWorker" in navigator) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
