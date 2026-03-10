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

const btnChangeFile = $("#btn-change-file");
const scanningOverlay = $("#scanning-overlay");
const resultCard = $(".result-card");
const resultHeading = $("#result-heading");
const scanningStatus = $("#scanning-status");

let scanner = null;
let cameraRunning = false;
let scanning = false;
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

  const log = [];
  const t0 = performance.now();
  const ts = () => `${(performance.now() - t0).toFixed(0)}ms`;

  log.push(`[${ts()}] startCamera() iniciado`);
  log.push(`[${ts()}] URL: ${location.href}`);
  log.push(`[${ts()}] Protocolo: ${location.protocol}`);
  log.push(`[${ts()}] UserAgent: ${navigator.userAgent}`);

  showCameraLoading();

  const TIMEOUT_MS = 15000;
  let timedOut = false;

  try {
    log.push(`[${ts()}] Creando Html5Qrcode...`);
    scanner = new Html5Qrcode("reader", {
      formatsToSupport: CAMERA_FORMATS,
      verbose: false,
    });

    const containerWidth = cameraContainer.clientWidth - 32;
    const qrboxWidth = Math.min(280, containerWidth);
    const qrboxHeight = Math.round(qrboxWidth * 0.7);
    log.push(`[${ts()}] Container: ${cameraContainer.clientWidth}px, qrbox: ${qrboxWidth}x${qrboxHeight}`);

    log.push(`[${ts()}] Llamando scanner.start()...`);
    const startPromise = scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: qrboxWidth, height: qrboxHeight } },
      (decodedText) => {
        showResult(decodedText);
        stopCamera();
      },
      () => {}
    );

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, TIMEOUT_MS);
    });

    await Promise.race([startPromise, timeoutPromise]);

    if (timedOut) return;

    cameraRunning = true;
    cameraPlaceholder.classList.add("hidden");
    log.push(`[${ts()}] Cámara iniciada OK`);
    alert("DEBUG CAMERA:\n\n" + log.join("\n"));
  } catch (err) {
    console.error("Error al iniciar cámara:", err);
    log.push(`[${ts()}] ERROR: ${err?.message || err}`);
    log.push(`[${ts()}] timedOut=${timedOut}`);
    alert("DEBUG CAMERA ERROR:\n\n" + log.join("\n"));

    if (timedOut) {
      try { await scanner?.stop(); } catch {}
      showCameraError(
        "La cámara tardó demasiado en responder. Verifica los permisos y recarga la página."
      );
    } else {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes("denied") || msg.includes("permission") || msg.includes("not allowed")) {
        showCameraError(
          "Permiso de cámara denegado. Activa el permiso en los ajustes del navegador y recarga."
        );
      } else if (msg.includes("secure") || msg.includes("https")) {
        showCameraError(
          "La cámara requiere conexión HTTPS. Verifica que la URL use https://."
        );
      } else if (msg.includes("not found") || msg.includes("no video")) {
        showCameraError(
          "No se encontró ninguna cámara en este dispositivo."
        );
      } else {
        showCameraError(
          `No se pudo iniciar la cámara: ${err?.message || err}`
        );
      }
    }

    scanner = null;
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
  console.log(`[handleFile] Inicio: ${file.name} (${file.type}, ${file.size} bytes)`);

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

    if (!scanning) {
      console.log("[handleFile] Escaneo cancelado (nueva imagen cargada)");
      return;
    }

    if (result) {
      console.log(`[handleFile] Resultado: engine=${result.engine}, format=${result.format}, text="${result.text}"`);
      showResult(result.text, result.format);
    } else {
      console.log("[handleFile] Sin resultado de ningún motor");
      showResult(
        "No se pudo decodificar el código de barras. Intenta con una foto de mejor resolución, bien enfocada y sin inclinación."
      );
    }
  } catch (err) {
    console.error("[handleFile] Error:", err);
    alert(`ERROR en handleFile:\n${err.message}\n\n${err.stack}`);
    if (scanning) showResult("Error al procesar la imagen.");
  }
}

btnCamera.addEventListener("click", () => setMode("camera"));
btnFile.addEventListener("click", () => setMode("file"));

btnStartCamera.addEventListener("click", startCamera);

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
