const models = require("../../models");
const { enqueueSuperReportJob } = require("../../services/super-admin-report-queue.service");
const { generateSuperAdminReportHTML } = require("../../services/report-formatter.service");
const { renderHtmlToPdfBuffer } = require("../../services/report-pdf.service");
const { asyncHandler } = require("../../utils/http");

const generateSuperReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const job = await db.superReportJob.create({
    data: {
      type: req.body.type,
      filters: req.body.filters || {},
      initiatedById: req.superAdmin.id,
    },
  });

  await enqueueSuperReportJob(job.id);

  res.status(202).json({
    message: "Super admin report queued",
    jobId: job.id,
    status: job.status,
  });
});

const getEscalatedAnomalies = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const rows = await db.auditLog.findMany({
    where: {
      action: "REPORT_ANOMALY_ESCALATED",
    },
    include: {
      college: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      admin: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      test: {
        select: {
          id: true,
          title: true,
          subject: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const data = rows.map((row) => ({
    id: row.id,
    escalatedAt: row.createdAt,
    college: row.college,
    admin: row.admin,
    test: row.test,
    anomalyId: row.afterState?.anomalyId || null,
    anomalyType: row.afterState?.anomalyType || null,
    reason: row.afterState?.reason || null,
    action: row.afterState?.action || "ESCALATE",
  }));

  res.status(200).json({ data });
});

const getSuperReportJobs = asyncHandler(async (_req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const jobs = await db.superReportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const data = jobs.map((job) => ({
    ...job,
    downloadUrl: job.resultUrl || null,
    downloadExpiresAt: job?.filters?.resultUrlExpiresAt || null,
  }));

  res.status(200).json(data);
});

const downloadSuperReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.superReportJob.findUnique({ where: { id: reportJobId } });
  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  if (job.status !== "COMPLETED") {
    return res.status(409).json({ message: "Report is not ready" });
  }

  const expiresAt = job?.filters?.resultUrlExpiresAt ? new Date(job.filters.resultUrlExpiresAt) : null;
  if (expiresAt && Number.isFinite(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
    return res.status(403).json({
      message: "Report download link expired",
      code: "REPORT_URL_EXPIRED",
      expiresAt: expiresAt.toISOString(),
    });
  }

  // Generate human-readable report and convert to PDF
  const reportData = {
    rows: Array.isArray(job.resultData) ? job.resultData : [],
  };

  const htmlContent = generateSuperAdminReportHTML(
    {
      ...job,
      generatedAt: job.updatedAt,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    },
    reportData
  );

  const pdfBuffer = await renderHtmlToPdfBuffer(htmlContent);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="super-admin-report-${reportJobId}.pdf"`);
  res.status(200).send(pdfBuffer);
});

const regenerateSuperReportLink = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.superReportJob.findUnique({ where: { id: reportJobId } });
  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  if (job.status !== "COMPLETED") {
    return res.status(409).json({ message: "Report is not ready" });
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const resultUrl = `/api/super-admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

  const updated = await db.superReportJob.update({
    where: { id: reportJobId },
    data: {
      resultUrl,
      filters: {
        ...(job.filters || {}),
        resultUrlExpiresAt: expiresAt,
      },
    },
  });

  res.status(200).json({
    reportJobId: updated.id,
    resultUrl,
    expiresAt,
  });
});

module.exports = {
  generateSuperReport,
  getSuperReportJobs,
  downloadSuperReport,
  regenerateSuperReportLink,
  getEscalatedAnomalies,
};
