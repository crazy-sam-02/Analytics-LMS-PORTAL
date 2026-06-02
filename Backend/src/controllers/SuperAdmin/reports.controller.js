const mongoose = require("mongoose");

const models = require("../../models");
const { enqueueSuperReportJob } = require("../../services/super-admin-report-queue.service");
const { generateSuperAdminReportHTML } = require("../../services/report-formatter.service");
const { renderHtmlToPdfBuffer } = require("../../services/report-pdf.service");
const { readReportPayload } = require("../../services/report-payload-store.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { clampPercent, getSubmissionScorePercent } = require("../../utils/score");

const PASS_THRESHOLD_PERCENT = 40;
const MAX_ANALYTICS_SUBMISSIONS = 20000;

const toPercent = (value) => clampPercent(value);
const getScorePercent = getSubmissionScorePercent;

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

const normalizeId = (value) => {
  const normalized = String(value || "").trim();
  return normalized === "all" ? "" : normalized;
};

const normalizeStudentYear = (value) => {
  if (value == null || value === "") return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 4 ? year : null;
};

const toValidDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const getViolationCount = (submission) =>
  Number(submission?._count?.violations ?? submission?.violations?.length ?? submission?.violationCount ?? 0);
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const toObjectIdIfValid = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || "")) ? new mongoose.Types.ObjectId(String(value)) : value;

const buildSuperReportCollegeWhere = (collegeId) => ({
  OR: [
    { "filters.collegeId": collegeId },
    { "filters.collegeId": toObjectIdIfValid(collegeId) },
  ],
});

const validateReportScope = async ({ db, collegeId, departmentId, studentId, testId }) => {
  if (collegeId) {
    const college = await db.college.findUnique({ where: { id: collegeId }, select: { id: true, isActive: true } });
    if (!college || !college.isActive) {
      throw new ApiError(404, "College not found or inactive");
    }
  }

  if (departmentId) {
    const department = await db.department.findFirst({
      where: {
        id: departmentId,
        ...(collegeId ? { collegeId } : {}),
      },
      select: { id: true, collegeId: true },
    });
    if (!department) {
      throw new ApiError(404, "Department not found for selected college");
    }
  }

  if (studentId) {
    const student = await db.student.findFirst({
      where: {
        id: studentId,
        ...(collegeId ? { collegeId } : {}),
        ...(departmentId ? { departmentId } : {}),
        isActive: true,
      },
      select: { id: true },
    });
    if (!student) {
      throw new ApiError(404, "Student not found for selected report scope");
    }
  }

  if (testId) {
    const test = await db.test.findFirst({
      where: {
        id: testId,
        ...(collegeId ? { collegeId } : {}),
      },
      select: { id: true },
    });
    if (!test) {
      throw new ApiError(404, "Test not found for selected report scope");
    }
  }
};

const generateSuperReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = req.body.filters || {};
  const collegeId = normalizeId(filters.collegeId);
  const departmentId = normalizeId(filters.departmentId);
  const studentId = normalizeId(filters.studentId);
  const testId = normalizeId(filters.testId);
  const year = normalizeStudentYear(filters.year);

  if (!collegeId) {
    throw new ApiError(400, "Select a college before generating a super admin report");
  }

  await validateReportScope({ db, collegeId, departmentId, studentId, testId });
  const reportFilters = { ...filters, collegeId };
  if (departmentId) reportFilters.departmentId = departmentId;
  if (studentId) reportFilters.studentId = studentId;
  if (testId) reportFilters.testId = testId;
  if (year) reportFilters.year = year;

  const job = await db.superReportJob.create({
    data: {
      type: req.body.type,
      filters: reportFilters,
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

const getSuperReportAnalytics = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  const departmentId = normalizeId(req.query.departmentId);
  const studentId = normalizeId(req.query.studentId);
  const testId = normalizeId(req.query.testId);
  const year = normalizeStudentYear(req.query.year);
  const dateFrom = toValidDate(req.query.dateFrom);
  const dateTo = toValidDate(req.query.dateTo);

  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing super admin report analytics");
  }

  await validateReportScope({ db, collegeId, departmentId, studentId, testId });
  const submittedAtFilter = {
    ...(dateFrom ? { gte: dateFrom } : {}),
    ...(dateTo ? { lte: dateTo } : {}),
  };

  const departmentBatchIds = departmentId
    ? (await db.batch.findMany({
        where: {
          departmentId,
          ...(collegeId ? { collegeId } : {}),
        },
        select: { id: true },
      })).map((batch) => batch.id)
    : [];

  const studentWhere = {
    ...(collegeId ? { collegeId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(studentId ? { id: studentId } : {}),
    ...(year ? { year } : {}),
    isActive: true,
  };

  const testWhere = {
    ...(collegeId ? { collegeId } : {}),
    ...(departmentId ? {
      OR: [
        { departmentId },
        { assignedTo: { in: [departmentId] } },
        ...(departmentBatchIds.length > 0
          ? [
              { batchId: { in: departmentBatchIds } },
              { batchAssignments: { some: { batchId: { in: departmentBatchIds } } } },
            ]
          : []),
      ],
    } : {}),
    ...(testId ? { id: testId } : {}),
  };
  const submissionWhere = {
    status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
    ...(collegeId ? { collegeId } : {}),
    ...(testId ? { testId } : {}),
    ...(Object.keys(submittedAtFilter).length ? { submittedAt: submittedAtFilter } : {}),
    ...(studentId ? { userId: studentId } : {}),
    ...(departmentId || studentId
      ? {
          user: {
            ...(departmentId ? { departmentId } : {}),
            ...(studentId ? { id: studentId } : {}),
            ...(year ? { year } : {}),
          },
        }
      : {}),
    ...(!departmentId && !studentId && year ? { user: { year } } : {}),
  };

  const submissionCount = await db.submission.count({ where: submissionWhere });
  if (submissionCount > MAX_ANALYTICS_SUBMISSIONS && !studentId) {
    throw new ApiError(
      413,
      "Report scope is too large. Select a department, test, student, or date range before loading analytics.",
      { submissionCount, maxSubmissions: MAX_ANALYTICS_SUBMISSIONS },
      "REPORT_SCOPE_TOO_LARGE"
    );
  }

  const [students, tests, departments, submissions] = await Promise.all([
    db.student.findMany({
      where: studentWhere,
      include: {
        college: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
      },
    }),
    db.test.findMany({
      where: testWhere,
      select: {
        id: true,
        title: true,
        subject: true,
        totalMarks: true,
        collegeId: true,
        departmentId: true,
        assignedTo: true,
        batchId: true,
      },
    }),
    db.department.findMany({
      where: {
        ...(collegeId ? { collegeId } : {}),
        ...(departmentId ? { id: departmentId } : {}),
      },
      include: {
        college: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ collegeId: "asc" }, { name: "asc" }],
    }),
    db.submission.findMany({
      where: submissionWhere,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            studentId: true,
            enrollNumber: true,
            enrollmentNumber: true,
            year: true,
            collegeId: true,
            departmentId: true,
            batchId: true,
            college: { select: { id: true, name: true, code: true } },
            department: { select: { id: true, name: true } },
            batch: { select: { id: true, name: true } },
          },
        },
        test: {
          select: {
            id: true,
            title: true,
            subject: true,
            totalMarks: true,
            collegeId: true,
            departmentId: true,
          },
        },
        ...(studentId
          ? {
              violations: {
                select: {
                  id: true,
                  type: true,
                  createdAt: true,
                  metadata: true,
                },
                orderBy: { createdAt: "desc" },
              },
              answers: {
                select: {
                  id: true,
                  questionId: true,
                },
              },
            }
          : {
              _count: {
                select: {
                  violations: true,
                },
              },
            }),
      },
      orderBy: { submittedAt: "asc" },
    }),
  ]);

  const scopedTestIds = new Set(tests.map((test) => test.id));
  const scopedStudentIds = new Set(students.map((student) => student.id));
  const scopedSubmissions = submissions.filter((submission) => {
    if (studentId && !scopedStudentIds.has(submission.userId)) return false;
    if (testId && !scopedTestIds.has(submission.testId)) return false;
    if (scopedStudentIds.size && !scopedStudentIds.has(submission.userId)) return false;
    if ((testId || departmentId) && !scopedTestIds.has(submission.testId)) return false;
    return true;
  });

  const submissionsByStudent = new Map();
  scopedSubmissions.forEach((submission) => {
    const key = submission.userId || submission.user?.id;
    if (!key) return;
    const list = submissionsByStudent.get(key) || [];
    list.push(submission);
    submissionsByStudent.set(key, list);
  });

  const studentRows = students.map((student) => {
    const rows = submissionsByStudent.get(student.id) || [];
    const avgScore = rows.length
      ? rows.reduce((sum, submission) => sum + getScorePercent(submission), 0) / rows.length
      : 0;
    const violations = rows.reduce((sum, submission) => sum + getViolationCount(submission), 0);

    return {
      studentId: student.id,
      name: student.fullName,
      rollNo: getStudentNumber(student),
      collegeId: student.collegeId,
      college: student.college?.name || "-",
      departmentId: student.departmentId,
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      year: student.year || null,
      avgScore: toPercent(avgScore),
      testsTaken: rows.length,
      violations,
      participation: tests.length > 0 ? toPercent((rows.length / tests.length) * 100) : 0,
    };
  });

  const rankedStudents = studentRows
    .filter((row) => row.testsTaken > 0)
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const rankedByStudentId = new Map(rankedStudents.map((row) => [row.studentId, row]));
  const tableRows = studentRows
    .map((row) => rankedByStudentId.get(row.studentId) || { ...row, rank: null })
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return a.name.localeCompare(b.name);
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });

  const avgScore = scopedSubmissions.length
    ? scopedSubmissions.reduce((sum, submission) => sum + getScorePercent(submission), 0) / scopedSubmissions.length
    : 0;
  const passRate = scopedSubmissions.length
    ? (scopedSubmissions.filter((submission) => getScorePercent(submission) >= PASS_THRESHOLD_PERCENT).length / scopedSubmissions.length) * 100
    : 0;
  const attemptedStudentIds = new Set(scopedSubmissions.map((submission) => submission.userId).filter(Boolean));
  const participationRate = students.length ? (attemptedStudentIds.size / students.length) * 100 : 0;
  const totalViolations = scopedSubmissions.reduce(
    (sum, submission) => sum + getViolationCount(submission),
    0
  );

  const trendMap = new Map();
  scopedSubmissions.forEach((submission) => {
    const key = deriveMonthKey(submission.submittedAt || submission.updatedAt || submission.createdAt);
    const current = trendMap.get(key) || { total: 0, count: 0 };
    current.total += getScorePercent(submission);
    current.count += 1;
    trendMap.set(key, current);
  });

  const scoreTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, stat]) => ({ month, score: toPercent(stat.total / Math.max(1, stat.count)) }));

  const subjectMap = new Map();
  scopedSubmissions.forEach((submission) => {
    const subject = submission.test?.subject || "General";
    const current = subjectMap.get(subject) || { total: 0, count: 0 };
    current.total += getScorePercent(submission);
    current.count += 1;
    subjectMap.set(subject, current);
  });

  const subjectPerformance = Array.from(subjectMap.entries())
    .map(([subject, stat]) => ({ subject, score: toPercent(stat.total / Math.max(1, stat.count)) }))
    .sort((a, b) => b.score - a.score);

  const distributionBase = {
    "0-20": 0,
    "21-40": 0,
    "41-60": 0,
    "61-80": 0,
    "81-100": 0,
  };
  rankedStudents.forEach((row) => {
    distributionBase[scoreBand(row.avgScore)] += 1;
  });

  const studentsByDepartment = new Map();
  students.forEach((student) => {
    const key = student.departmentId || "unknown";
    const list = studentsByDepartment.get(key) || [];
    list.push(student);
    studentsByDepartment.set(key, list);
  });

  const submissionsByDepartment = new Map();
  scopedSubmissions.forEach((submission) => {
    const key = submission.user?.departmentId || "unknown";
    const list = submissionsByDepartment.get(key) || [];
    list.push(submission);
    submissionsByDepartment.set(key, list);
  });

  const departmentRows = departments.map((department) => {
    const deptStudents = studentsByDepartment.get(department.id) || [];
    const deptSubmissions = submissionsByDepartment.get(department.id) || [];
    const deptAttempted = new Set(deptSubmissions.map((submission) => submission.userId).filter(Boolean));
    const deptAvg = deptSubmissions.length
      ? deptSubmissions.reduce((sum, submission) => sum + getScorePercent(submission), 0) / deptSubmissions.length
      : 0;
    const deptPass = deptSubmissions.length
      ? (deptSubmissions.filter((submission) => getScorePercent(submission) >= PASS_THRESHOLD_PERCENT).length / deptSubmissions.length) * 100
      : 0;
    const deptViolations = deptSubmissions.reduce(
      (sum, submission) => sum + getViolationCount(submission),
      0
    );

    return {
      departmentId: department.id,
      department: department.name,
      collegeId: department.collegeId,
      college: department.college?.name || "-",
      students: deptStudents.length,
      submissions: deptSubmissions.length,
      avgScore: toPercent(deptAvg),
      passRate: toPercent(deptPass),
      participation: deptStudents.length ? toPercent((deptAttempted.size / deptStudents.length) * 100) : 0,
      violations: deptViolations,
    };
  });

  const selectedStudentBase = studentId ? students.find((student) => student.id === studentId) : null;
  const selectedStudentRank = studentId ? rankedByStudentId.get(studentId) : null;
  const selectedStudentSubmissions = studentId ? scopedSubmissions.filter((submission) => submission.userId === studentId) : [];
  const selectedStudent = selectedStudentBase
    ? {
        id: selectedStudentBase.id,
        name: selectedStudentBase.fullName,
        studentId: getStudentNumber(selectedStudentBase),
        college: selectedStudentBase.college?.name || "-",
        department: selectedStudentBase.department?.name || "-",
        batch: selectedStudentBase.batch?.name || "-",
        year: selectedStudentBase.year || null,
        rank: selectedStudentRank?.rank || null,
      }
    : null;

  const attemptHistory = selectedStudentSubmissions
    .map((submission) => {
      const totalQuestions = Array.isArray(submission.answers) ? submission.answers.length : 0;
      const scorePercent = getScorePercent(submission);
      const violationEvents = (submission.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        submissionId: submission.id,
      }));

      return {
        id: submission.id,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        subject: submission.test?.subject || "General",
        scorePercent,
        score: Number(submission.score || 0),
        timeTaken: Number(submission.timeSpentSeconds || 0),
        status: submission.status,
        date: submission.submittedAt || submission.updatedAt || submission.createdAt,
        violationsCount: violationEvents.length,
        violationEvents,
        questionAnalysis: {
          total: totalQuestions,
          correct: totalQuestions ? Math.round((scorePercent / 100) * totalQuestions) : 0,
        },
      };
    })
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  res.status(200).json({
    filters: {
      collegeId: collegeId || null,
      departmentId: departmentId || null,
      studentId: studentId || null,
      testId: testId || null,
      year: year || null,
    },
    metrics: {
      totalStudents: students.length,
      attemptedStudents: attemptedStudentIds.size,
      totalTests: tests.length,
      totalSubmissions: scopedSubmissions.length,
      avgScore: toPercent(avgScore),
      passRate: toPercent(passRate),
      participationRate: toPercent(participationRate),
      violations: totalViolations,
    },
    scoreTrend,
    subjectPerformance,
    distribution: Object.entries(distributionBase).map(([range, count]) => ({ range, count })),
    departmentRows,
    tableRows,
    selectedStudent,
    attemptHistory,
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

const getSuperReportJobs = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = normalizeId(req.query.collegeId);
  if (!collegeId) {
    throw new ApiError(400, "Select a college before viewing super admin report exports");
  }

  await validateReportScope({ db, collegeId });

  const jobs = await db.superReportJob.findMany({
    where: buildSuperReportCollegeWhere(collegeId),
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const data = jobs
    .map((job) => ({
      ...job,
      resultData: undefined,
      resultDataRef: undefined,
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
  const storedPayload = job.resultDataRef ? await readReportPayload(job.resultDataRef) : null;
  const reportData = storedPayload
    ? storedPayload
    : Array.isArray(job.resultData)
      ? { rows: job.resultData }
      : job.resultData || { rows: [] };

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
  res.setHeader("Cache-Control", "private, no-store");
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
  getSuperReportAnalytics,
  getSuperReportJobs,
  downloadSuperReport,
  regenerateSuperReportLink,
  getEscalatedAnomalies,
};
