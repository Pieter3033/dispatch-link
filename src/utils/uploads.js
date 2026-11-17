const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

let fileTypeModulePromise;

const IMAGE_TYPES = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
]);

const EXCEL_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv"
]);

const PDF_TYPES = new Set(["application/pdf"]);

function getExtension(fileName) {
  return path.extname(String(fileName || "")).replace(".", "").toLowerCase();
}

function sanitizeBaseName(fileName) {
  return path
    .basename(String(fileName || ""), path.extname(String(fileName || "")))
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "upload";
}

async function detectFile(buffer) {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = import("file-type");
  }
  const { fileTypeFromBuffer } = await fileTypeModulePromise;
  const detected = await fileTypeFromBuffer(buffer);
  return detected
    ? { ext: detected.ext.toLowerCase(), mime: detected.mime.toLowerCase() }
    : null;
}

async function validatePhotoUpload(file) {
  if (!file || !file.buffer || !file.size) {
    throw new Error("Photo upload is empty.");
  }
  const detected = await detectFile(file.buffer);
  const ext = getExtension(file.originalname);
  const detectedMime = detected?.mime;
  const candidateExt = detected?.ext || ext;

  if (!IMAGE_TYPES.has(candidateExt)) {
    throw new Error("Photo must be a JPG, JPEG, PNG, or WEBP image.");
  }

  const expectedMime = IMAGE_TYPES.get(candidateExt);
  if (detectedMime && detectedMime !== expectedMime) {
    throw new Error("Photo content does not match the selected file type.");
  }

  return {
    ext: candidateExt,
    mime: detectedMime || expectedMime
  };
}

async function validateHistoryUpload(file, fileType) {
  if (!file || !file.buffer || !file.size) {
    throw new Error("File upload is empty.");
  }

  const detected = await detectFile(file.buffer);
  const ext = getExtension(file.originalname);
  const mime = (detected?.mime || String(file.mimetype || "").toLowerCase()).toLowerCase();

  if (fileType === "HistoryPdf") {
    if (ext !== "pdf" || (!PDF_TYPES.has(mime) && detected?.mime)) {
      throw new Error("History PDF upload must be a valid PDF file.");
    }
    return { ext: "pdf", mime: "application/pdf" };
  }

  const allowedExt = new Set(["xlsx", "xls", "csv"]);
  if (!allowedExt.has(ext)) {
    throw new Error("History Excel upload must be xlsx, xls, or csv.");
  }

  if (detected?.mime && !EXCEL_TYPES.has(detected.mime.toLowerCase())) {
    throw new Error("History Excel upload content does not match the selected file type.");
  }

  if (!detected?.mime && mime && !EXCEL_TYPES.has(mime) && ext !== "csv" && ext !== "xls") {
    throw new Error("History Excel upload has an unsupported content type.");
  }

  return {
    ext,
    mime: mime || (ext === "csv" ? "text/csv" : "application/vnd.ms-excel")
  };
}

async function persistUpload(targetDir, file, ext) {
  await fs.mkdir(targetDir, { recursive: true });
  const baseName = sanitizeBaseName(file.originalname);
  const storedFileName = `${crypto.randomUUID()}-${baseName}.${ext}`;
  const absolutePath = path.resolve(targetDir, storedFileName);
  await fs.writeFile(absolutePath, file.buffer);
  return {
    storedFileName,
    absolutePath
  };
}

function toPublicUploadPath(uploadRoot, absolutePath) {
  const relative = path.relative(uploadRoot, absolutePath);
  if (relative.startsWith("..")) {
    throw new Error("Resolved upload path is outside the upload root.");
  }
  return relative.split(path.sep).join("/");
}

module.exports = {
  persistUpload,
  toPublicUploadPath,
  validateHistoryUpload,
  validatePhotoUpload
};
