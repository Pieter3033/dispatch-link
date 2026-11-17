const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const uploadRoot = path.resolve(
  process.cwd(),
  process.env.DISPATCH_UPLOAD_ROOT || "storage/dispatch-uploads"
);

module.exports = {
  port: parseInteger(process.env.PORT, 3100),
  host: (process.env.HOST || "127.0.0.1").trim(),
  approvers: (process.env.DISPATCH_APPROVERS || "Approver1,Approver2,Approver3")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  uploads: {
    root: uploadRoot,
    photos: path.join(uploadRoot, "photos"),
    files: path.join(uploadRoot, "files"),
    pdf: path.join(uploadRoot, "pdf"),
    maxBytes: parseInteger(process.env.DISPATCH_MAX_UPLOAD_BYTES, 10 * 1024 * 1024)
  },
  db: {
    server: required("DISPATCH_DB_SERVER"),
    port: parseInteger(process.env.DISPATCH_DB_PORT, 1433),
    user: required("DISPATCH_DB_USER"),
    password: required("DISPATCH_DB_PASSWORD"),
    database: required("DISPATCH_DB_DATABASE"),
    authDatabase: (process.env.DISPATCH_AUTH_DATABASE || "Jobcard").trim(),
    options: {
      encrypt: parseBoolean(process.env.DISPATCH_DB_ENCRYPT, true),
      trustServerCertificate: parseBoolean(process.env.DISPATCH_DB_TRUST_SERVER_CERT, false)
    }
  },
  bisHistory: {
    url: (process.env.BIS_HISTORY_API_URL || "http://127.0.0.1:43128").trim().replace(/\/+$/, ""),
    token: (process.env.BIS_HISTORY_API_TOKEN || "").trim(),
    hours: parseInteger(process.env.BIS_HISTORY_HOURS, 24)
  }
};
