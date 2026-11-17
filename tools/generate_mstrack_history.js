const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
process.chdir(projectRoot);

const reportsRoot = path.resolve(projectRoot, "public", "generated-reports");
const maxReportAgeMs = 24 * 60 * 60 * 1000;

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanExpiredReports() {
  if (!fs.existsSync(reportsRoot)) return;
  const cutoff = Date.now() - maxReportAgeMs;
  for (const entry of fs.readdirSync(reportsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/i.test(entry.name)) continue;
    const directory = path.resolve(reportsRoot, entry.name);
    if (!isPathInside(reportsRoot, directory)) continue;
    const stats = fs.statSync(directory);
    if (stats.mtimeMs < cutoff) fs.rmSync(directory, { recursive: true, force: true });
  }
}

function writePdf(filePath, incident, history, generateBisHistoryPdf) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: "wx" });
    output.once("finish", resolve);
    output.once("error", reject);
    try {
      generateBisHistoryPdf(incident, history, output);
    } catch (error) {
      output.destroy();
      reject(error);
    }
  });
}

async function main() {
  const incidentId = Number(process.argv[2]);
  const format = String(process.argv[3] || "json").toLowerCase();
  if (!Number.isInteger(incidentId) || incidentId <= 0) throw new Error("A valid incident ID is required.");
  if (!["json", "xls", "pdf"].includes(format)) throw new Error("Unsupported MSTrack report format.");

  const incident = parseIncident(process.argv[4], incidentId);
  // Load optional connector settings without importing the Node backend's
  // configuration, SQL client, or Dispatch database services.
  require("dotenv").config({ path: path.join(projectRoot, ".env"), quiet: true });
  const { fetchBisHistory } = require("../src/services/bisHistoryService");
  const { buildBisHistoryExcel, generateBisHistoryPdf, reportBaseName } = require("../src/services/bisHistoryReportService");
  cleanExpiredReports();
  const history = await fetchBisHistory(incident);
  if (!history.configured) {
    const error = new Error("The MSTrack connector is not configured.");
    error.reportCode = "connector-config";
    throw error;
  }

  const token = crypto.randomBytes(16).toString("hex");
  const reportDirectory = path.resolve(reportsRoot, token);
  if (!isPathInside(reportsRoot, reportDirectory)) throw new Error("Invalid report output path.");
  fs.mkdirSync(reportDirectory, { recursive: true });

  const filename = format === "json" ? "mstrack-history.json" : `${reportBaseName(incident)}.${format}`;
  const finalPath = path.resolve(reportDirectory, filename);
  const temporaryPath = `${finalPath}.tmp`;
  if (!isPathInside(reportDirectory, finalPath)) throw new Error("Invalid report filename.");

  try {
    if (format === "json") {
      fs.writeFileSync(temporaryPath, JSON.stringify(history), { encoding: "utf8", flag: "wx" });
    } else if (format === "xls") {
      fs.writeFileSync(temporaryPath, buildBisHistoryExcel(incident, history), { encoding: "utf8", flag: "wx" });
    } else {
      await writePdf(temporaryPath, incident, history, generateBisHistoryPdf);
    }
    fs.renameSync(temporaryPath, finalPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (fs.existsSync(reportDirectory) && !fs.readdirSync(reportDirectory).length) fs.rmdirSync(reportDirectory);
    throw error;
  }

  return `/dispatch_link/public/generated-reports/${token}/${encodeURIComponent(filename)}`;
}

function parseIncident(value, incidentId) {
  let incident;
  try { incident = JSON.parse(value); } catch (_error) {}
  if (!incident || Array.isArray(incident) || Number(incident.id) !== incidentId) {
    const error = new Error("Dispatch details must be supplied by SQLPage.");
    error.reportCode = "incident-input";
    throw error;
  }
  return incident;
}

function reportErrorUrl(error) {
  const code = error.reportCode || (error.code === "MODULE_NOT_FOUND" ? "report-runtime"
    : ["EACCES", "EPERM", "ENOSPC", "EROFS"].includes(error.code) ? "report-output" : "report-generation");
  return `/dispatch_link/public/completed.html?reportError=mstrack-${encodeURIComponent(code)}`;
}

if (require.main === module) {
  main().then((url) => {
    process.stdout.write(url, () => process.exit(0));
  }).catch((error) => {
    const url = reportErrorUrl(error);
    // Use a controlled failure code; raw dependency/database errors can contain secrets.
    process.stderr.write(`MSTrack report failed: ${url.split("reportError=")[1]}\n`);
    process.stdout.write(url, () => process.exit(0));
  });
}

module.exports = { main, parseIncident, reportErrorUrl };
