import "./style.css";
import { scanFromFile } from "./scanner";

const $ = (sel) => document.querySelector(sel);

const btnCamera = $("#btn-camera");
const btnFile = $("#btn-file");
const cameraContainer = $("#camera-container");
const fileContainer = $("#file-container");
const cameraPlaceholder = $("#camera-placeholder");
const btnStartCamera = $("#btn-start-camera");
const cameraViewfinder = $("#camera-viewfinder");
const cameraVideo = $("#camera-video");
const btnCapture = $("#btn-capture");
const btnStopCamera = $("#btn-stop-camera");
const fileInput = $("#file-input");
const dropZone = $("#drop-zone");
const filePreview = $("#file-preview");
const previewImg = $("#preview-img");
const resultSection = $("#result-section");
const resultText = $("#result-text");
const btnCopy = $("#btn-copy");
const btnOpen = $("#btn-open");
const btnChangeFile = $("#btn-change-file");
const scanningOverlay = $("#scanning-overlay");
const resultCard = $(".result-card");
const resultHeading = $("#result-heading");
const scanningStatus = $("#scanning-status");

let cameraStream = null;
let cameraRunning = false;
let autoScanTimer = null;
let scanning = false;
let capturing = false;
let currentPreviewUrl = null;

function isUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function resetFileState() {
  fileInput.value = "";
  filePreview.classList.add("hidden");
  dropZone.classList.remove("hidden");
  scanningOverlay.classList.add("hidden");
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
}

function showScanning(msg) {
  resultSection.classList.remove("hidden");
  resultCard.classList.add("hidden");
  scanningStatus.classList.remove("hidden");
  scanningStatus.querySelector("span").textContent = msg;
  resultHeading.textContent = "Analizando";
  btnOpen.classList.add("hidden");
}

function showResult(text, format) {
  scanning = false;
  scanningOverlay.classList.add("hidden");
  scanningStatus.classList.add("hidden");
  resultCard.classList.remove("hidden");
  resultSection.classList.remove("hidden");
  resultText.textContent = text;

  if (format) {
    resultHeading.innerHTML = `Resultado <span class="format-badge">${format}</span>`;
  } else {
    resultHeading.textContent = "Resultado";
  }

  if (isUrl(text)) {
    btnOpen.classList.remove("hidden");
    btnOpen.onclick = () => window.open(text, "_blank", "noopener");
  } else {
    btnOpen.classList.add("hidden");
  }

  resultSection.scrollIntoView({ behavior: "smooth" });
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

// ── Camera ──

function showCameraLoading() {
  cameraPlaceholder.classList.remove("hidden");
  btnStartCamera.classList.add("hidden");
  cameraPlaceholder.querySelector("p").textContent = "Iniciando cámara...";
  const icon = cameraPlaceholder.querySelector("svg");
  if (icon) icon.style.display = "none";
  let spinner = cameraPlaceholder.querySelector(".camera-loading-spinner");
  if (!spinner) {
    spinner = document.createElement("div");
    spinner.className = "camera-loading-spinner";
    cameraPlaceholder.prepend(spinner);
  }
  spinner.style.display = "";
}

function showCameraError(msg) {
  cameraViewfinder.classList.add("hidden");
  cameraPlaceholder.classList.remove("hidden");
  btnStartCamera.classList.remove("hidden");
  cameraPlaceholder.querySelector("p").textContent = msg;
  const icon = cameraPlaceholder.querySelector("svg");
  if (icon) icon.style.display = "";
  const spinner = cameraPlaceholder.querySelector(".camera-loading-spinner");
  if (spinner) spinner.style.display = "none";
}

async function startCamera() {
  if (cameraRunning) return;

  showCameraLoading();

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();

    cameraRunning = true;
    cameraPlaceholder.classList.add("hidden");
    cameraViewfinder.classList.remove("hidden");

    startAutoScan();
  } catch (err) {
    console.error("Error al iniciar cámara:", err);
    const msg = String(err?.message || err).toLowerCase();

    if (msg.includes("denied") || msg.includes("permission") || msg.includes("not allowed")) {
      showCameraError("Permiso de cámara denegado. Activa el permiso en los ajustes del navegador y recarga.");
    } else if (msg.includes("secure") || msg.includes("https")) {
      showCameraError("La cámara requiere conexión HTTPS. Verifica que la URL use https://.");
    } else if (msg.includes("not found") || msg.includes("no video") || msg.includes("requested device not found")) {
      showCameraError("No se encontró ninguna cámara en este dispositivo.");
    } else {
      showCameraError(`No se pudo iniciar la cámara: ${err?.message || err}`);
    }
  }
}

function stopCamera() {
  stopAutoScan();
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraRunning = false;
  cameraViewfinder.classList.add("hidden");
  cameraPlaceholder.classList.remove("hidden");
  btnStartCamera.classList.remove("hidden");
  cameraPlaceholder.querySelector("p").textContent = "Presiona para iniciar la cámara";
  const icon = cameraPlaceholder.querySelector("svg");
  if (icon) icon.style.display = "";
  const spinner = cameraPlaceholder.querySelector(".camera-loading-spinner");
  if (spinner) spinner.style.display = "none";
}

function captureViewfinder() {
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
  const cropW = Math.round(vw * 0.80);
  const cropH = Math.round(cropW / 1.4);
  const cropX = Math.round((vw - cropW) / 2);
  const cropY = Math.round((vh - cropH) / 2 - vh * 0.05);

  const canvas = document.createElement("canvas");
  canvas.width = cropW;
  canvas.height = cropH;
  canvas.getContext("2d").drawImage(
    cameraVideo, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH
  );
  return canvas;
}

function captureFullFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;
  canvas.getContext("2d").drawImage(cameraVideo, 0, 0);
  return canvas;
}

async function canvasToFile(canvas, name) {
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.95));
  return new File([blob], name, { type: "image/jpeg" });
}

async function captureAndScan() {
  if (capturing || !cameraRunning) return;
  capturing = true;
  btnCapture.disabled = true;
  btnCapture.classList.add("capturing");

  stopAutoScan();
  showScanning("Analizando captura...");

  try {
    const croppedFile = await canvasToFile(captureViewfinder(), "crop.jpg");
    let result = await scanFromFile(croppedFile, (msg) => showScanning(msg));

    if (!result) {
      showScanning("Probando frame completo...");
      const fullFile = await canvasToFile(captureFullFrame(), "full.jpg");
      result = await scanFromFile(fullFile, (msg) => showScanning(msg));
    }

    if (result) {
      showResult(result.text, result.format);
    } else {
      showResult("No se detectó ningún código. Acerca más el código a la cámara e intenta de nuevo.");
    }
  } catch (err) {
    console.error("Error al procesar captura:", err);
    showResult("Error al procesar la captura.");
  } finally {
    capturing = false;
    btnCapture.disabled = false;
    btnCapture.classList.remove("capturing");
    if (cameraRunning) startAutoScan();
  }
}

function startAutoScan() {
  stopAutoScan();
  if (!window.BarcodeDetector) return;

  const detector = new window.BarcodeDetector();

  autoScanTimer = setInterval(async () => {
    if (!cameraRunning || capturing) return;
    if (cameraVideo.readyState < cameraVideo.HAVE_ENOUGH_DATA) return;

    try {
      const results = await detector.detect(cameraVideo);
      if (results.length > 0 && results[0].rawValue) {
        showResult(results[0].rawValue, results[0].format);
      }
    } catch {
      // frame not ready
    }
  }, 400);
}

function stopAutoScan() {
  if (autoScanTimer) {
    clearInterval(autoScanTimer);
    autoScanTimer = null;
  }
}

// ── File handling ──

async function handleFile(file) {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }

  scanning = true;
  currentPreviewUrl = URL.createObjectURL(file);
  previewImg.src = currentPreviewUrl;
  filePreview.classList.remove("hidden");
  dropZone.classList.add("hidden");
  scanningOverlay.classList.remove("hidden");

  showScanning("Analizando imagen...");

  try {
    const result = await scanFromFile(file, (msg) => {
      if (scanning) showScanning(msg);
    });

    if (!scanning) return;

    if (result) {
      showResult(result.text, result.format);
    } else {
      showResult(
        "No se pudo decodificar el código de barras. Intenta con una foto de mejor resolución, bien enfocada y sin inclinación."
      );
    }
  } catch (err) {
    console.error("Error al escanear archivo:", err);
    if (scanning) showResult("Error al procesar la imagen.");
  }
}

// ── Event listeners ──

btnCamera.addEventListener("click", () => setMode("camera"));
btnFile.addEventListener("click", () => setMode("file"));

btnStartCamera.addEventListener("click", startCamera);
btnStopCamera.addEventListener("click", stopCamera);
btnCapture.addEventListener("click", captureAndScan);

btnChangeFile.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("click", () => {
  fileInput.value = "";
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("drag-over");
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith("image/")) {
    handleFile(file);
  }
}

dropZone.addEventListener("dragover", handleDragOver);
dropZone.addEventListener("dragleave", handleDragLeave);
dropZone.addEventListener("drop", handleDrop);

filePreview.addEventListener("dragover", handleDragOver);
filePreview.addEventListener("dragleave", handleDragLeave);
filePreview.addEventListener("drop", handleDrop);

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
