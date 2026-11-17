const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
process.chdir(projectRoot);

const {
  fetchIncidentReportData,
  generateIncidentReport,
  incidentReportFileName
} = require("../src/services/incidentReportService");

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

async function main() {
  const incidentId = Number(process.argv[2]);
  if (!Number.isInteger(incidentId) || incidentId <= 0) {
    throw new Error("A valid incident ID is required.");
  }

  cleanExpiredReports();
  const data = await fetchIncidentReportData(incidentId);
  const filename = incidentReportFileName(data.incident);
  const token = crypto.randomBytes(16).toString("hex");
  const reportDirectory = path.resolve(reportsRoot, token);
  if (!isPathInside(reportsRoot, reportDirectory)) throw new Error("Invalid report output path.");
  fs.mkdirSync(reportDirectory, { recursive: true });

  const finalPath = path.resolve(reportDirectory, filename);
  const temporaryPath = `${finalPath}.tmp`;
  if (!isPathInside(reportDirectory, finalPath)) throw new Error("Invalid report filename.");

  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  const finished = new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });

  try {
    await generateIncidentReport(data, output);
    await finished;
    fs.renameSync(temporaryPath, finalPath);
  } catch (error) {
    output.destroy();
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    if (fs.existsSync(reportDirectory) && !fs.readdirSync(reportDirectory).length) fs.rmdirSync(reportDirectory);
    throw error;
  }

  const reportUrl = `/dispatch_link/public/generated-reports/${token}/${encodeURIComponent(filename)}`;
  process.stdout.write(reportUrl, () => process.exit(0));
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`, () => process.exit(1));
});
