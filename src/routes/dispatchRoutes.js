const express = require("express");
const multer = require("multer");
const config = require("../config");
const { requireApprover, requireAuth } = require("../middleware/auth");
const {
  PHOTO_CATEGORIES,
  addHistoryFile,
  addPhotoUpload,
  approveIncident,
  createDraft,
  getAuditTrail,
  getBisHistoryIncident,
  getIncidentDetail,
  listIncidents,
  listPendingApprovals,
  lookupRegistration,
  rejectIncident,
  submitIncident,
  updateDraft
} = require("../services/dispatchService");
const {
  fetchIncidentReportData,
  generateIncidentReport,
  incidentReportFileName
} = require("../services/incidentReportService");
const { validateHistoryUpload, validatePhotoUpload, persistUpload, toPublicUploadPath } = require("../utils/uploads");
const { createHttpError } = require("../utils/httpError");
const { fetchBisHistory } = require("../services/bisHistoryService");
const { buildBisHistoryExcel, generateBisHistoryPdf, reportBaseName } = require("../services/bisHistoryReportService");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxBytes,
    files: 1
  }
});

router.use(requireAuth);

router.get("/current-user", async (req, res) => {
  res.json({ user: req.authUser });
});

router.get("/dispatch-metadata", (_req, res) => {
  res.json({
    photoCategories: PHOTO_CATEGORIES,
    approvers: config.approvers
  });
});

router.get("/dispatch-incidents", async (req, res, next) => {
  try {
    const result = await listIncidents({
      status: req.query.status,
      search: req.query.search,
      createdBy: req.query.scope === "mine" ? req.authUser.username : null
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/dispatch-registration-lookup", async (req, res, next) => {
  try {
    const result = await lookupRegistration(req.query.reg_no || req.query.registration);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/dispatch-incidents/:id", async (req, res, next) => {
  try {
    const result = await getIncidentDetail(Number(req.params.id));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/dispatch-incidents/:id/report", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw createHttpError(422, "A valid dispatch incident ID is required.");
    }
    const data = await fetchIncidentReportData(id);
    const filename = incidentReportFileName(data.incident);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    await generateIncidentReport(data, res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return next(error);
  }
});

router.get("/dispatch-incidents/:id/bis-history", async (req, res, next) => {
  try {
    const incident = await getBisHistoryIncident(Number(req.params.id));
    if (incident.DispatchStatus !== "Closed" && incident.Status !== "Approved") {
      throw createHttpError(409, "MSTrack history is available only for completed dispatches.");
    }
    res.json(await fetchBisHistory(incident));
  } catch (error) {
    next(error);
  }
});

async function loadDownloadableBisHistory(id) {
  const incident = await getBisHistoryIncident(id);
  if (incident.DispatchStatus !== "Closed" && incident.Status !== "Approved") {
    throw createHttpError(409, "MSTrack history is available only for completed dispatches.");
  }
  const history = await fetchBisHistory(incident);
  if (!history.configured) throw createHttpError(503, "MSTrack history connector is not configured.");
  return { incident, history };
}

router.get("/dispatch-incidents/:id/bis-history.xls", async (req, res, next) => {
  try {
    const { incident, history } = await loadDownloadableBisHistory(Number(req.params.id));
    const filename = `${reportBaseName(incident)}.xls`;
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buildBisHistoryExcel(incident, history));
  } catch (error) {
    next(error);
  }
});

router.get("/dispatch-incidents/:id/bis-history.pdf", async (req, res, next) => {
  try {
    const { incident, history } = await loadDownloadableBisHistory(Number(req.params.id));
    const filename = `${reportBaseName(incident)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    generateBisHistoryPdf(incident, history, res);
  } catch (error) {
    next(error);
  }
});

router.post("/dispatch-incidents", express.json(), async (req, res, next) => {
  try {
    const result = await createDraft(req.authUser, req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.put("/dispatch-incidents/:id", express.json(), async (req, res, next) => {
  try {
    const result = await updateDraft(Number(req.params.id), req.authUser, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/dispatch-incidents/:id/photos", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw createHttpError(422, "Photo file is required.");
    }
    const validation = await validatePhotoUpload(req.file);
    const saved = await persistUpload(config.uploads.photos, req.file, validation.ext);
    const result = await addPhotoUpload(
      Number(req.params.id),
      req.authUser,
      {
        originalFileName: req.file.originalname,
        storedFileName: saved.storedFileName,
        mimeType: validation.mime,
        bytes: req.file.size
      },
      toPublicUploadPath(config.uploads.root, saved.absolutePath),
      {
        photoCategory: req.body.photoCategory,
        notes: req.body.notes
      }
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/dispatch-incidents/:id/files", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw createHttpError(422, "History file is required.");
    }
    const fileType = String(req.body.fileType || "").trim();
    const validation = await validateHistoryUpload(req.file, fileType);
    const saved = await persistUpload(config.uploads.files, req.file, validation.ext);
    const result = await addHistoryFile(
      Number(req.params.id),
      req.authUser,
      {
        originalFileName: req.file.originalname,
        storedFileName: saved.storedFileName,
        mimeType: validation.mime,
        bytes: req.file.size
      },
      toPublicUploadPath(config.uploads.root, saved.absolutePath),
      fileType
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/dispatch-incidents/:id/submit", async (req, res, next) => {
  try {
    const result = await submitIncident(Number(req.params.id), req.authUser);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/dispatch-approvals/pending", async (_req, res, next) => {
  try {
    const result = await listPendingApprovals();
    res.json({ incidents: result });
  } catch (error) {
    next(error);
  }
});

router.post("/dispatch-incidents/:id/approve", requireApprover, express.json(), async (req, res, next) => {
  try {
    const result = await approveIncident(Number(req.params.id), req.authUser, req.body.approvalComments);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/dispatch-incidents/:id/reject", requireApprover, express.json(), async (req, res, next) => {
  try {
    const result = await rejectIncident(Number(req.params.id), req.authUser, req.body.rejectionReason);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/dispatch-incidents/:id/audit", async (req, res, next) => {
  try {
    const result = await getAuditTrail(Number(req.params.id));
    res.json({ audit: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
