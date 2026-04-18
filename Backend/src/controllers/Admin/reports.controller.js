const prisma = require("../../config/db");
const { enqueueReportJob } = require("../../services/admin-report-queue.service");
const { createAuditLog } = require("../../services/audit.service");
const { emitToRole } = require("../../realtime/socket");
const { asyncHandler } = require("../../utils/http");

const toPercent = (value) => Number((value || 0).toFixed(2));

const scoreBand = (score) => {
  if (score <= 20) return "0-20";
  if (score <= 40) return "21-40";
  if (score <= 60) return "41-60";
  if (score <= 80) return "61-80";
  return "81-100";
};

const deriveMonthKey = (dateLike) => {
  const date = new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const getReportJobStatus = asyncHandler(async (req, res) => {
  const { reportJobId } = req.params;

  const job = await prisma.reportJob.findFirst({
    where: {
      id: reportJobId,
      collegeId: req.collegeId,
    },
  });

  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  const expiresAt = job?.filters?.resultUrlExpiresAt || null;
  const progress = Number(job?.filters?.progress || 0);

  res.status(200).json({
    jobId: job.id,
    status: String(job.status || "QUEUED").toLowerCase(),
    progress,
    download_url: job.resultUrl || null,
    expires_at: expiresAt,
  });
});

const getReportAnalytics = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const mode = req.query.mode;
  const testId = req.query.testId;
  const departmentId = req.query.departmentId;
  const batchId = req.query.batchId;
  const studentId = req.query.studentId;

  const testWhere = {
    collegeId,
    ...(testId ? { id: testId } : {}),
  };

  const studentWhere = {
    collegeId,
    ...(departmentId ? { departmentId } : {}),
    ...(batchId ? { batchId } : {}),
    ...(studentId ? { id: studentId } : {}),
  };

  const tests = await prisma.test.findMany({
    where: testWhere,
    select: { id: true, title: true, subject: true, totalMarks: true, departmentId: true, batchId: true },
  });

  const testIds = tests.map((item) => item.id);
  const submissions = await prisma.submission.findMany({
    where: {
      collegeId,
      ...(testIds.length ? { testId: { in: testIds } } : {}),
      ...(studentId ? { userId: studentId } : {}),
      status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
    },
    include: {
      user: { select: { id: true, fullName: true, studentId: true, departmentId: true, batchId: true } },
      test: { select: { id: true, title: true, subject: true, totalMarks: true } },
      violations: { select: { id: true } },
      answers: {
        select: {
          questionId: true,
          selectedOption: true,
          answerText: true,
          answerBoolean: true,
        },
      },
    },
    orderBy: { submittedAt: "asc" },
  });

  const scopedSubmissions = submissions.filter((item) => {
    if (departmentId && item.user?.departmentId !== departmentId) return false;
    if (batchId && item.user?.batchId !== batchId) return false;
    return true;
  });

  const students = await prisma.student.findMany({
    where: studentWhere,
    include: {
      department: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  });

  const departments = await prisma.department.findMany({ where: { collegeId }, select: { id: true, name: true } });
  const batches = await prisma.batch.findMany({ where: { collegeId }, select: { id: true, name: true, year: true } });

  const submissionsByStudent = new Map();
  scopedSubmissions.forEach((item) => {
    const key = item.userId;
    const list = submissionsByStudent.get(key) || [];
    list.push(item);
    submissionsByStudent.set(key, list);
  });

  const studentRows = students.map((student) => {
    const rows = submissionsByStudent.get(student.id) || [];
    const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.score || 0), 0) / rows.length : 0;
    const violations = rows.reduce((sum, row) => sum + Number(row.violationCount || row.violations?.length || 0), 0);
    return {
      studentId: student.id,
      name: student.fullName,
      rollNo: student.studentId,
      departmentId: student.departmentId,
      departmentName: student.department?.name || "-",
      batchId: student.batchId,
      batchName: student.batch?.name || "-",
      avgScore: toPercent(average),
      testsTaken: rows.length,
      violations,
      participation: tests.length > 0 ? toPercent((rows.length / tests.length) * 100) : 0,
    };
  });

  const ranked = [...studentRows].sort((a, b) => b.avgScore - a.avgScore).map((item, index) => ({ ...item, rank: index + 1 }));
  const avgScore = ranked.length ? ranked.reduce((sum, row) => sum + row.avgScore, 0) / ranked.length : 0;
  const passRate = scopedSubmissions.length
    ? (scopedSubmissions.filter((row) => {
        const totalMarks = Number(row.test?.totalMarks || 100);
        return Number(row.score || 0) >= totalMarks * 0.4;
      }).length / scopedSubmissions.length) * 100
    : 0;
  const participatingStudents = ranked.filter((item) => item.testsTaken > 0).length;
  const participationRate = ranked.length ? (participatingStudents / ranked.length) * 100 : 0;
  const totalViolations = ranked.reduce((sum, item) => sum + item.violations, 0);

  const trendMap = new Map();
  scopedSubmissions.forEach((row) => {
    const key = deriveMonthKey(row.submittedAt || row.updatedAt || row.createdAt);
    const existing = trendMap.get(key) || { total: 0, count: 0 };
    existing.total += Number(row.score || 0);
    existing.count += 1;
    trendMap.set(key, existing);
  });

  const scoreTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, stat]) => ({ month, score: toPercent(stat.total / Math.max(1, stat.count)) }));

  const topicMap = new Map();
  scopedSubmissions.forEach((row) => {
    const topic = row.test?.subject || "General";
    const existing = topicMap.get(topic) || { total: 0, count: 0 };
    existing.total += Number(row.score || 0);
    existing.count += 1;
    topicMap.set(topic, existing);
  });

  const topicPerformance = Array.from(topicMap.entries()).map(([topic, stat]) => ({
    topic,
    score: toPercent(stat.total / Math.max(1, stat.count)),
  }));

  const departmentComparative = departments.map((department) => {
    const rows = ranked.filter((row) => row.departmentId === department.id);
    const deptAvg = rows.length ? rows.reduce((sum, row) => sum + row.avgScore, 0) / rows.length : 0;
    const deptParticipation = rows.length ? (rows.filter((row) => row.testsTaken > 0).length / rows.length) * 100 : 0;
    const deptPassRate = rows.length ? (rows.filter((row) => row.avgScore >= 40).length / rows.length) * 100 : 0;
    return {
      departmentId: department.id,
      departmentName: department.name,
      avgScore: toPercent(deptAvg),
      passRate: toPercent(deptPassRate),
      participationRate: toPercent(deptParticipation),
    };
  });

  const batchComparative = batches.map((batch) => {
    const rows = ranked.filter((row) => row.batchId === batch.id);
    const value = rows.length ? rows.reduce((sum, row) => sum + row.avgScore, 0) / rows.length : 0;
    const pass = rows.length ? (rows.filter((row) => row.avgScore >= 40).length / rows.length) * 100 : 0;
    return {
      batchId: batch.id,
      batchName: batch.name,
      avgScore: toPercent(value),
      passRate: toPercent(pass),
    };
  });

  const distributionBase = {
    "0-20": 0,
    "21-40": 0,
    "41-60": 0,
    "61-80": 0,
    "81-100": 0,
  };
  ranked.forEach((row) => {
    distributionBase[scoreBand(row.avgScore)] += 1;
  });

  const selectedStudent = ranked.find((row) => row.studentId === studentId) || null;
  const attemptHistory = scopedSubmissions
    .filter((row) => !studentId || row.userId === studentId)
    .map((row) => ({
      testName: row.test?.title || "Test",
      score: Number(row.score || 0),
      percentile: row.percentile ?? null,
      timeTaken: Number(row.timeSpentSeconds || 0),
      date: row.submittedAt || row.updatedAt || row.createdAt,
      status: row.status,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const anomalyAlerts = [];

  scopedSubmissions.forEach((row) => {
    const totalMarks = Number(row.test?.totalMarks || 100);
    const scorePercent = totalMarks > 0 ? (Number(row.score || 0) / totalMarks) * 100 : Number(row.score || 0);
    const mins = Number(row.timeSpentSeconds || 0) / 60;
    const violationCount = Number(row.violationCount || row.violations?.length || 0);

    if (scorePercent >= 80 && mins > 0 && mins <= 3) {
      anomalyAlerts.push({
        id: `fast-${row.id}`,
        type: "UNUSUALLY_FAST_HIGH_SCORE",
        severity: "HIGH",
        studentId: row.userId,
        studentName: row.user?.fullName || "Student",
        testId: row.testId,
        testName: row.test?.title || "Test",
        message: "High score submitted in unusually short duration",
        createdAt: row.submittedAt || row.updatedAt || row.createdAt,
      });
    }

    if (scorePercent >= 80 && violationCount >= 3) {
      anomalyAlerts.push({
        id: `viol-high-${row.id}`,
        type: "HIGH_VIOLATIONS_HIGH_SCORE",
        severity: "MEDIUM",
        studentId: row.userId,
        studentName: row.user?.fullName || "Student",
        testId: row.testId,
        testName: row.test?.title || "Test",
        message: "High score with high violation count",
        createdAt: row.submittedAt || row.updatedAt || row.createdAt,
      });
    }
  });

  const signatureBuckets = new Map();
  scopedSubmissions.forEach((row) => {
    const signature = (row.answers || [])
      .sort((a, b) => String(a.questionId).localeCompare(String(b.questionId)))
      .map((answer) => `${answer.questionId}:${answer.selectedOption || answer.answerBoolean || answer.answerText || ""}`)
      .join("|");

    if (!signature) return;

    const key = `${row.testId}::${signature}`;
    const bucket = signatureBuckets.get(key) || [];
    bucket.push(row);
    signatureBuckets.set(key, bucket);
  });

  signatureBuckets.forEach((bucket, key) => {
    if (bucket.length < 2) return;
    const testName = bucket[0]?.test?.title || "Test";
    const studentNames = bucket.map((item) => item.user?.fullName || "Student");

    anomalyAlerts.push({
      id: `pattern-${key}`,
      type: "IDENTICAL_ANSWER_PATTERN",
      severity: "HIGH",
      testId: bucket[0]?.testId,
      testName,
      students: studentNames,
      message: `Similar answer pattern detected across ${bucket.length} submissions`,
      createdAt: bucket[0]?.submittedAt || bucket[0]?.updatedAt || bucket[0]?.createdAt,
    });
  });

  res.status(200).json({
    mode,
    metrics: {
      avgScore: toPercent(avgScore),
      passRate: toPercent(passRate),
      participationRate: toPercent(participationRate),
      violations: totalViolations,
    },
    scoreTrend,
    topicPerformance,
    departmentComparative,
    batchComparative,
    distribution: Object.entries(distributionBase).map(([range, count]) => ({ range, count })),
    tableRows: ranked,
    attemptHistory,
    selectedStudent,
    anomalyAlerts: anomalyAlerts.slice(0, 100),
  });
});

const ENTITY_SCOPED_CHECKS = {
  STUDENT_WISE: { key: "studentId", model: "student", message: "Student not found for this college" },
  TEST_WISE: { key: "testId", model: "test", message: "Test not found for this college" },
  DEPARTMENT_WISE: { key: "departmentId", model: "department", message: "Department not found for this college" },
  BATCH_WISE: { key: "batchId", model: "batch", message: "Batch not found for this college" },
};

const normalizeFilters = (filters = {}) => {
  const normalized = {
    studentId: filters.studentId || undefined,
    testId: filters.testId || undefined,
    departmentId: filters.departmentId || undefined,
    batchId: filters.batchId || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value != null));
};

const validateScopedFilters = async ({ type, filters, collegeId }) => {
  const rule = ENTITY_SCOPED_CHECKS[type];
  if (rule && filters?.[rule.key]) {
    const exists = await prisma[rule.model].findFirst({
      where: {
        id: filters[rule.key],
        collegeId,
      },
      select: { id: true },
    });

    if (!exists) {
      return { ok: false, status: 404, message: rule.message };
    }
  }

  if (filters?.dateFrom && filters?.dateTo) {
    const from = new Date(filters.dateFrom);
    const to = new Date(filters.dateTo);
    if (from > to) {
      return { ok: false, status: 422, message: "dateFrom cannot be later than dateTo" };
    }
  }

  return { ok: true };
};

const generateReport = asyncHandler(async (req, res) => {
  const filters = normalizeFilters(req.body.filters || {});
  const validation = await validateScopedFilters({
    type: req.body.type,
    filters,
    collegeId: req.collegeId,
  });

  if (!validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const job = await prisma.reportJob.create({
    data: {
      type: req.body.type,
      filters,
      collegeId: req.collegeId,
      adminId: req.admin.id,
    },
  });

  await enqueueReportJob(job.id);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: "Report generation queued",
  });
});

const getReportJobs = asyncHandler(async (req, res) => {
  const jobs = await prisma.reportJob.findMany({
    where: {
      collegeId: req.collegeId,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const safeJobs = jobs.map((job) => {
    const filters = { ...(job.filters || {}) };
    const downloadExpiresAt = filters.resultUrlExpiresAt || null;
    delete filters.generatedData;

    return {
      ...job,
      filters,
      downloadUrl: job.resultUrl || null,
      downloadExpiresAt,
    };
  });

  res.status(200).json(safeJobs);
});

const downloadReport = asyncHandler(async (req, res) => {
  const { reportJobId } = req.params;

  const job = await prisma.reportJob.findFirst({
    where: {
      id: reportJobId,
      collegeId: req.collegeId,
    },
  });

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

  const reportRows = Array.isArray(job.filters?.generatedData) ? job.filters.generatedData : [];

  res.status(200).json({
    reportJobId,
    type: job.type,
    generatedAt: job.updatedAt,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    rows: reportRows,
  });
});

const regenerateReportLink = asyncHandler(async (req, res) => {
  const { reportJobId } = req.params;

  const job = await prisma.reportJob.findFirst({
    where: {
      id: reportJobId,
      collegeId: req.collegeId,
    },
  });

  if (!job) {
    return res.status(404).json({ message: "Report job not found" });
  }

  if (job.status !== "COMPLETED") {
    return res.status(409).json({ message: "Report is not ready" });
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const resultUrl = `/api/admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

  const updated = await prisma.reportJob.update({
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

const reviewAnomaly = asyncHandler(async (req, res) => {
  const { testId, anomalyId, anomalyType, action, reason } = req.body;

  const test = await prisma.test.findFirst({
    where: {
      id: testId,
      collegeId: req.collegeId,
    },
  });

  if (!test) {
    return res.status(404).json({ message: "Test not found for this college" });
  }

  const existingReviews = Array.isArray(test.anomalyReviews) ? test.anomalyReviews : [];
  const beforeReview = existingReviews.find((item) => item?.anomalyId === anomalyId) || null;

  const nextReview = {
    anomalyId,
    anomalyType,
    action,
    reason,
    reviewedAt: new Date().toISOString(),
    reviewedByAdminId: req.admin.id,
  };

  const nextReviews = [
    ...existingReviews.filter((item) => item?.anomalyId !== anomalyId),
    nextReview,
  ];

  await prisma.test.update({
    where: { id: test.id },
    data: {
      anomalyReviews: nextReviews,
    },
  });

  await createAuditLog({
    action: action === "ESCALATE" ? "REPORT_ANOMALY_ESCALATED" : "REPORT_ANOMALY_DISMISSED",
    targetType: "TEST_ANOMALY",
    targetId: `${test.id}:${anomalyId}`,
    collegeId: req.collegeId,
    adminId: req.admin.id,
    testId: test.id,
    beforeState: beforeReview,
    afterState: nextReview,
  });

  if (action === "ESCALATE") {
    emitToRole("SUPER_ADMIN", "report:anomaly_escalated", {
      collegeId: req.collegeId,
      adminId: req.admin.id,
      adminName: req.admin.fullName,
      testId: test.id,
      anomalyId,
      anomalyType,
      reason,
      escalatedAt: nextReview.reviewedAt,
    });
  }

  res.status(200).json({
    message: "Anomaly review saved",
    review: nextReview,
  });
});

module.exports = {
  generateReport,
  getReportJobs,
  getReportJobStatus,
  getReportAnalytics,
  downloadReport,
  regenerateReportLink,
  reviewAnomaly,
};
