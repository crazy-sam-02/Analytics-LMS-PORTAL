const models = require("../../models");
const { enqueueReportJob } = require("../../services/admin-report-queue.service");
const { generateAdminReportHTML } = require("../../services/report-formatter.service");
const { renderHtmlToPdfBuffer } = require("../../services/report-pdf.service");
const { readReportPayload } = require("../../services/report-payload-store.service");
const { createAuditLog } = require("../../services/audit.service");
const { emitToRole } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { clampPercent, getSubmissionScorePercent } = require("../../utils/score");
const { getScopedDepartmentId } = require("../../utils/admin-scope");

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

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const resolveSubmissionStudentId = (submission) => submission?.userId || submission?.studentId || submission?.user?.id || null;
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const normalizeId = (value) => String(value || "").trim();

const normalizeIdList = (values = []) =>
  [...new Set(values.map((value) => normalizeId(value)).filter(Boolean))];

const buildEmptyAnalyticsPayload = (mode = "department") => ({
  mode,
  metrics: {
    avgScore: 0,
    passRate: 0,
    participationRate: 0,
    violations: 0,
  },
  scoreTrend: [],
  topicPerformance: [],
  departmentComparative: [],
  batchComparative: [],
  distribution: [
    { range: "0-20", count: 0 },
    { range: "21-40", count: 0 },
    { range: "41-60", count: 0 },
    { range: "61-80", count: 0 },
    { range: "81-100", count: 0 },
  ],
  tableRows: [],
  attemptHistory: [],
  selectedStudent: null,
  notAttended: {
    count: 0,
    students: [],
    testId: null,
    testName: null,
  },
  anomalyAlerts: [],
});

const buildAdminReportScope = async ({ db, req, filters = {}, testSelect = { id: true } }) => {
  const collegeId = req.collegeId;
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });
  const requestedDepartmentId = filters.departmentId ? normalizeId(filters.departmentId) : null;
  const departmentId = adminDepartmentId ? normalizeId(adminDepartmentId) : (requestedDepartmentId || null);

  if (adminDepartmentId && requestedDepartmentId && normalizeId(adminDepartmentId) !== requestedDepartmentId) {
    return { ok: false, reason: "DEPARTMENT_OUT_OF_SCOPE" };
  }

  const departmentBatches = await db.batch.findMany({
    where: { collegeId, ...(departmentId ? { departmentId } : {}) },
    select: { id: true },
  });
  const departmentBatchIds = normalizeIdList(departmentBatches.map((batch) => batch.id));

  const requestedBatchId = filters.batchId ? normalizeId(filters.batchId) : null;
  if (requestedBatchId && !departmentBatchIds.includes(requestedBatchId)) {
    return { ok: false, reason: "BATCH_OUT_OF_SCOPE" };
  }

  const batchScopeIds = requestedBatchId ? [requestedBatchId] : departmentBatchIds;

  const testWhere = {
    collegeId,
    ...(filters.testId ? { id: filters.testId } : {}),
    ...(departmentId ? { OR: [
      { assignmentMethod: "department_wise", departmentId },
      { assignmentMethod: "department_wise", assignedTo: { in: [departmentId] } },
      { assignmentMethod: null, departmentId },
      { assignmentMethod: null, assignedTo: { in: [departmentId] } },
      { assignmentMethod: "batch_wise", batchId: { in: batchScopeIds } },
      { assignmentMethod: "batch_wise", batchAssignments: { some: { batchId: { in: batchScopeIds } } } },
      { assignmentMethod: "department_wise", departmentId: null, batchId: { in: batchScopeIds } },
      { assignmentMethod: "department_wise", departmentId: null, batchAssignments: { some: { batchId: { in: batchScopeIds } } } },
      { assignmentMethod: null, batchId: { in: batchScopeIds } },
      { assignmentMethod: null, batchAssignments: { some: { batchId: { in: batchScopeIds } } } },
    ] } : {}),
    ...(!departmentId && requestedBatchId ? {
      OR: [
        { batchId: requestedBatchId },
        { batchAssignments: { some: { batchId: requestedBatchId } } },
      ],
    } : {}),
  };

  const tests = await db.test.findMany({
    where: testWhere,
    select: testSelect,
  });

  return {
    ok: true,
    tests,
    testIds: normalizeIdList(tests.map((test) => test.id)),
    departmentId,
    batchId: requestedBatchId,
    batchIds: batchScopeIds,
  };
};

const getReportJobStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.reportJob.findFirst({
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
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const mode = req.query.mode;
  const testId = req.query.testId;
  const departmentId = req.query.departmentId;
  const batchId = req.query.batchId;
  const studentId = req.query.studentId;
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;
  const dateFromValue = toValidDate(dateFrom);
  const dateToValue = toValidDate(dateTo);

  const scope = await buildAdminReportScope({
    db,
    req,
    filters: { testId, departmentId, batchId },
    testSelect: { id: true, title: true, subject: true, totalMarks: true, departmentId: true, batchId: true },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return res.status(200).json(buildEmptyAnalyticsPayload(mode));
  }

  const tests = Array.isArray(scope.tests) ? scope.tests : [];
  const testIds = scope.testIds;
  const scopedDepartmentId = scope.departmentId;
  const scopedBatchId = scope.batchId;

  const studentWhere = {
    collegeId,
    ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
    ...(scopedBatchId
      ? {
          OR: [
            { batchId: scopedBatchId },
            { batchIds: { in: [scopedBatchId] } },
          ],
        }
      : {}),
    ...(studentId ? { id: studentId } : {}),
  };
  const submissionWhere = {
    collegeId,
    ...(testIds.length ? { testId: { in: testIds } } : {}),
    ...(studentId ? { userId: studentId } : {}),
    status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
    ...(dateFromValue || dateToValue
      ? {
          submittedAt: {
            ...(dateFromValue ? { gte: dateFromValue } : {}),
            ...(dateToValue ? { lte: dateToValue } : {}),
          },
        }
      : {}),
    ...(scopedDepartmentId || scopedBatchId
      ? {
          user: {
            ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
            ...(scopedBatchId
              ? {
                  OR: [
                    { batchId: scopedBatchId },
                    { batchIds: { in: [scopedBatchId] } },
                  ],
                }
              : {}),
          },
        }
      : {}),
  };

  const submissionCount = await db.submission.count({ where: submissionWhere });
  if (submissionCount > MAX_ANALYTICS_SUBMISSIONS && !studentId) {
    throw new ApiError(
      413,
      "Report scope is too large. Select a test, student, or date range before loading analytics.",
      { submissionCount, maxSubmissions: MAX_ANALYTICS_SUBMISSIONS },
      "REPORT_SCOPE_TOO_LARGE"
    );
  }

  const submissions = await db.submission.findMany({
    where: submissionWhere,
    include: {
      user: { select: { id: true, fullName: true, studentId: true, enrollNumber: true, enrollmentNumber: true, departmentId: true, batchId: true, batchIds: true } },
      test: { select: { id: true, title: true, subject: true, totalMarks: true } },
      violations: {
        select: {
          id: true,
          type: true,
          createdAt: true,
          metadata: true,
        },
      },
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
    if (scopedDepartmentId && item.user?.departmentId !== scopedDepartmentId) return false;
    if (
      scopedBatchId &&
      item.user?.batchId !== scopedBatchId &&
      !(Array.isArray(item.user?.batchIds) && item.user.batchIds.some((id) => String(id) === String(scopedBatchId)))
    ) return false;

    const eventDate = toValidDate(item.submittedAt || item.updatedAt || item.createdAt);
    if (dateFromValue && (!eventDate || eventDate < dateFromValue)) return false;
    if (dateToValue && (!eventDate || eventDate > dateToValue)) return false;

    return true;
  });

  const students = await db.student.findMany({
    where: studentWhere,
    include: {
      department: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
    },
  });

  const departments = await db.department.findMany({ where: { collegeId }, select: { id: true, name: true } });
  const batches = await db.batch.findMany({ where: { collegeId }, select: { id: true, name: true, year: true } });

  const submissionsByStudent = new Map();
  scopedSubmissions.forEach((item) => {
    const key = resolveSubmissionStudentId(item);
    if (!key) return;
    const list = submissionsByStudent.get(key) || [];
    list.push(item);
    submissionsByStudent.set(key, list);
  });

  const studentRows = students.map((student) => {
    const rows = submissionsByStudent.get(student.id) || [];
    const average = rows.length ? rows.reduce((sum, row) => sum + getScorePercent(row), 0) / rows.length : 0;
    const violations = rows.reduce((sum, row) => sum + Number(row.violationCount || row.violations?.length || 0), 0);
    const violationEvents = rows
      .flatMap((row) =>
        (row.violations || []).map((violation) => ({
          id: violation.id,
          type: violation.type,
          anomalyId: violation.id,
          anomalyType: violation.type,
          createdAt: violation.createdAt,
          metadata: violation.metadata || null,
          testId: row.testId,
          testName: row.test?.title || "Test",
          submissionId: row.id,
        }))
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      studentId: student.id,
      name: student.fullName,
      rollNo: getStudentNumber(student),
      departmentId: student.departmentId,
      departmentName: student.department?.name || "-",
      batchId: student.batchId,
      batchName: student.batch?.name || "-",
      avgScore: toPercent(average),
      testsTaken: rows.length,
      violations,
      violationEvents,
      participation: tests.length > 0 ? toPercent((rows.length / tests.length) * 100) : 0,
    };
  });

  const hasSelectedTest = Boolean(testId);
  const selectedTest = hasSelectedTest
    ? tests.find((test) => normalizeId(test.id) === normalizeId(testId)) || tests[0]
    : null;
  const notAttendedRows = hasSelectedTest ? studentRows.filter((row) => row.testsTaken === 0) : [];
  const notAttendedStudents = notAttendedRows.map((row) => ({
    studentId: row.studentId,
    name: row.name,
    rollNo: row.rollNo,
    department: row.departmentName,
    batch: row.batchName,
  }));

  const attendedRows = studentRows.filter((row) => row.testsTaken > 0);
  const ranked = [...attendedRows].sort((a, b) => b.avgScore - a.avgScore).map((item, index) => ({ ...item, rank: index + 1 }));
  const avgScore = ranked.length ? ranked.reduce((sum, row) => sum + row.avgScore, 0) / ranked.length : 0;
  const passRate = scopedSubmissions.length
    ? (scopedSubmissions.filter((row) => getScorePercent(row) >= 40).length / scopedSubmissions.length) * 100
    : 0;
  const participatingStudents = attendedRows.length;
  const participationRate = studentRows.length ? (participatingStudents / studentRows.length) * 100 : 0;
  const totalViolations = ranked.reduce((sum, item) => sum + item.violations, 0);

  const trendMap = new Map();
  scopedSubmissions.forEach((row) => {
    const key = deriveMonthKey(row.submittedAt || row.updatedAt || row.createdAt);
    const existing = trendMap.get(key) || { total: 0, count: 0 };
    existing.total += getScorePercent(row);
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
    existing.total += getScorePercent(row);
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
    .filter((row) => {
      const rowStudentId = resolveSubmissionStudentId(row);
      return !studentId || rowStudentId === studentId;
    })
    .map((row) => ({
      id: row.id,
      testId: row.testId,
      testName: row.test?.title || "Test",
      scorePercent: getScorePercent(row),
      percentile: row.percentile ?? null,
      timeTaken: Number(row.timeSpentSeconds || 0),
      date: row.submittedAt || row.updatedAt || row.createdAt,
      status: row.status,
      violationsCount: Number(row.violationCount || row.violations?.length || 0),
      violationEvents: (row.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        anomalyId: violation.id,
        anomalyType: violation.type,
        testId: row.testId,
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
        testName: row.test?.title || "Test",
        submissionId: row.id,
      })),
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const anomalyAlerts = [];

  scopedSubmissions.forEach((row) => {
    const scorePercent = getScorePercent(row);
    const mins = Number(row.timeSpentSeconds || 0) / 60;
    const violationCount = Number(row.violationCount || row.violations?.length || 0);

    if (scorePercent >= 80 && mins > 0 && mins <= 3) {
      anomalyAlerts.push({
        id: `fast-${row.id}`,
        type: "UNUSUALLY_FAST_HIGH_SCORE",
        severity: "HIGH",
        studentId: resolveSubmissionStudentId(row),
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
        studentId: resolveSubmissionStudentId(row),
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
    notAttended: {
      count: hasSelectedTest ? notAttendedStudents.length : 0,
      students: hasSelectedTest ? notAttendedStudents : [],
      testId: hasSelectedTest ? testId : null,
      testName: selectedTest?.title || null,
    },
    anomalyAlerts: anomalyAlerts.slice(0, 100),
  });
});

const resolveDateFilters = (query = {}) => {
  const dateFromInput = query.dateFrom;
  const dateToInput = query.dateTo;
  const validDateFrom = toValidDate(dateFromInput);
  const validDateTo = toValidDate(dateToInput);

  const result = {
    testId: query.testId,
    departmentId: query.departmentId,
    batchId: query.batchId,
    studentId: query.studentId,
    dateFrom: validDateFrom ? validDateFrom.toISOString() : undefined,
    dateTo: validDateTo ? validDateTo.toISOString() : undefined,
    mode: query.mode || "department",
  };

  if (!result.dateFrom && !result.dateTo && query.dateRange && query.dateRange !== "custom") {
    const now = Date.now();
    const days = query.dateRange === "7d" ? 7 : query.dateRange === "90d" ? 90 : 30;
    result.dateFrom = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
    result.dateTo = new Date(now).toISOString();
  }

  return result;
};

const fetchAnalyticsPayload = async (req, filters = {}) => {
  const mockReq = {
    ...req,
    query: {
      ...req.query,
      ...filters,
    },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const mockRes = {
      status: () => ({
        json: (data) => {
          finish(data);
          return data;
        },
      }),
    };

    getReportAnalytics(mockReq, mockRes, (error) => {
      if (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
        return;
      }

      finish(null);
    });
  });
};

const getReportSummaryDashboard = asyncHandler(async (req, res) => {
  const filters = resolveDateFilters(req.query || {});
  const analytics = await fetchAnalyticsPayload(req, filters);
  const tableRows = Array.isArray(analytics?.tableRows) ? analytics.tableRows : [];
  const attempted = tableRows.filter((item) => Number(item.testsTaken || 0) > 0);
  const scores = tableRows.map((item) => Number(item.avgScore || 0));
  const highestScore = scores.length ? Math.max(...scores) : 0;
  const lowestScore = scores.length ? Math.min(...scores) : 0;

  res.status(200).json({
    summary: {
      totalStudentsAttempted: attempted.length,
      averageScore: Number(analytics?.metrics?.avgScore || 0),
      highestScore: Number(highestScore || 0),
      lowestScore: Number(lowestScore || 0),
      completionRate: Number(analytics?.metrics?.participationRate || 0),
    },
    sparkline: Array.isArray(analytics?.scoreTrend) ? analytics.scoreTrend : [],
    leaderboard: tableRows.slice(0, 10).map((item) => ({
      studentId: item.studentId,
      rank: item.rank,
      name: item.name,
      batch: item.batchName,
      score: item.avgScore,
    })),
  });
});

const getReportChartsDashboard = asyncHandler(async (req, res) => {
  const filters = resolveDateFilters(req.query || {});
  const analytics = await fetchAnalyticsPayload(req, filters);
  const topPerformers = (analytics?.tableRows || []).slice(0, 10).map((item) => ({
    studentId: item.studentId,
    studentName: item.name,
    score: Number(item.avgScore || 0),
  }));

  res.status(200).json({
    scoreDistribution: analytics?.distribution || [],
    performanceTrend: (analytics?.scoreTrend || []).map((item) => ({
      date: item.month,
      averageScore: Number(item.score || 0),
    })),
    departmentPerformance: (analytics?.departmentComparative || []).map((item) => ({
      department: item.departmentName,
      avgScore: Number(item.avgScore || 0),
      passRate: Number(item.passRate || 0),
      participationRate: Number(item.participationRate || 0),
    })),
    topPerformers,
  });
});

const getReportTableDashboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const filters = resolveDateFilters(req.query || {});
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const sortBy = String(req.query.sortBy || "date");
  const sortDir = String(req.query.sortDir || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const search = String(req.query.search || req.query.studentSearch || "").trim().toLowerCase();

  const scope = await buildAdminReportScope({
    db,
    req,
    filters: {
      testId: filters.testId,
      departmentId: filters.departmentId,
      batchId: filters.batchId,
    },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return res.status(200).json({
      data: [],
      pagination: {
        page: 1,
        limit,
        total: 0,
        totalPages: 1,
      },
    });
  }

  const scopedDepartmentId = scope.departmentId;
  const scopedBatchId = scope.batchId;

  const submissions = await db.submission.findMany({
    where: {
      collegeId: req.collegeId,
      status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      ...(scope.testIds.length ? { testId: { in: scope.testIds } } : {}),
      ...(filters.studentId ? { userId: filters.studentId } : {}),
      ...(scopedDepartmentId || scopedBatchId
        ? {
          user: {
            ...(scopedDepartmentId ? { departmentId: scopedDepartmentId } : {}),
            ...(scopedBatchId
              ? {
                  OR: [
                    { batchId: scopedBatchId },
                    { batchIds: { in: [scopedBatchId] } },
                  ],
                }
              : {}),
          },
        }
      : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            submittedAt: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          studentId: true,
          enrollNumber: true,
          enrollmentNumber: true,
          department: { select: { name: true } },
          batch: { select: { name: true } },
        },
      },
      test: {
        select: {
          title: true,
          totalMarks: true,
        },
      },
      violations: {
        select: { id: true, type: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { violations: true },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  const attemptsPerStudent = submissions.reduce((acc, submission) => {
    const key = resolveSubmissionStudentId(submission);
    if (!key) return acc;
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});

  let rows = submissions.map((submission) => {
    const score = Number(submission.score || 0);
    const accuracy = getScorePercent(submission);
    const date = submission.submittedAt || submission.updatedAt || submission.createdAt || new Date();

    return {
      id: submission.id,
      submissionId: submission.id,
      studentId: resolveSubmissionStudentId(submission),
      studentName: submission.user?.fullName || "-",
      studentRollNo: getStudentNumber(submission.user),
      department: submission.user?.department?.name || "-",
      batch: submission.user?.batch?.name || "-",
      testName: submission.test?.title || "-",
      score,
      accuracy,
      timeTaken: Number(submission.timeSpentSeconds || 0),
      attemptCount: Number(attemptsPerStudent[resolveSubmissionStudentId(submission)] || 0),
      status: submission.status || "IN_PROGRESS",
      violationCount: Number(submission._count?.violations || submission.violations?.length || 0),
      violations: (submission.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        createdAt: violation.createdAt,
      })),
      date: new Date(date).toISOString(),
    };
  });

  if (search) {
    rows = rows.filter((row) => {
      const text = `${row.studentName} ${row.studentRollNo} ${row.department} ${row.batch} ${row.testName}`.toLowerCase();
      return text.includes(search);
    });
  }

  rows.sort((a, b) => {
    const av = a?.[sortBy];
    const bv = b?.[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  res.status(200).json({
    data: rows.slice(start, start + limit),
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
  });
});

const getReportStudentDetailDashboard = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const studentId = req.params.studentId;
  const filters = resolveDateFilters({ ...req.query, studentId });
  const scope = await buildAdminReportScope({
    db,
    req,
    filters: {
      testId: filters.testId,
      departmentId: filters.departmentId,
      batchId: filters.batchId,
    },
  });

  if (!scope.ok || scope.testIds.length === 0) {
    return res.status(200).json({
      student: null,
      tests: [],
      accuracyGraph: [],
      timePerQuestion: [],
    });
  }

  const analytics = await fetchAnalyticsPayload(req, {
    ...filters,
    departmentId: scope.departmentId,
    batchId: scope.batchId,
  });

  const student = await db.student.findFirst({
    where: {
      id: studentId,
      collegeId: req.collegeId,
      ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
      ...(scope.batchId
        ? {
            OR: [
              { batchId: scope.batchId },
              { batchIds: { in: [scope.batchId] } },
            ],
          }
        : {}),
    },
    include: {
      department: { select: { name: true } },
      batch: { select: { name: true } },
      submissions: {
        where: {
          status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
          ...(scope.testIds.length ? { testId: { in: scope.testIds } } : {}),
          ...(filters.dateFrom || filters.dateTo
            ? {
                createdAt: {
                  ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
                  ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
                },
              }
            : {}),
        },
        include: {
          test: { select: { title: true, totalMarks: true } },
          answers: { select: { questionId: true } },
          violations: {
            select: {
              id: true,
              type: true,
              createdAt: true,
              metadata: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });

  if (!student) {
    return res.status(404).json({ message: "Student not found" });
  }

  const tests = (student.submissions || []).map((submission) => {
    const totalQuestions = (submission.answers || []).length;
    const accuracy = getScorePercent(submission);
    const correct = Math.max(0, Math.min(totalQuestions, Math.round((accuracy / 100) * totalQuestions)));
    const incorrect = Math.max(0, totalQuestions - correct);

    return {
      id: submission.id,
      testId: submission.testId,
      testName: submission.test?.title || "Test",
      score: Number(submission.score || 0),
      scorePercent: accuracy,
      accuracy,
      percentile: submission.percentile ?? null,
      timeTaken: Number(submission.timeSpentSeconds || 0),
      status: submission.status,
      date: (submission.submittedAt || submission.updatedAt || submission.createdAt || new Date()).toISOString(),
      violationsCount: Number(submission.violationCount || submission.violations?.length || 0),
      violationEvents: (submission.violations || []).map((violation) => ({
        id: violation.id,
        type: violation.type,
        anomalyId: violation.id,
        anomalyType: violation.type,
        testId: submission.testId,
        testName: submission.test?.title || "Test",
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
        submissionId: submission.id,
      })),
      questionAnalysis: {
        correct,
        incorrect,
        total: totalQuestions,
      },
    };
  });

  const accuracyGraph = tests.map((item) => ({
    date: new Date(item.date).toLocaleDateString(),
    accuracy: Number(item.accuracy || 0),
  }));

  const timePerQuestion = [];
  const baseAttempt = student.submissions?.[0];
  if (baseAttempt && Array.isArray(baseAttempt.answers) && baseAttempt.answers.length > 0) {
    const perQuestion = Number(baseAttempt.timeSpentSeconds || 0) / baseAttempt.answers.length;
    baseAttempt.answers.slice(0, 12).forEach((answer, index) => {
      timePerQuestion.push({
        question: `Q${index + 1}`,
        seconds: Number(perQuestion.toFixed(1)),
      });
    });
  }

  const selected = analytics?.selectedStudent || null;

  res.status(200).json({
    student: {
      id: student.id,
      name: student.fullName,
      studentId: getStudentNumber(student),
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      rank: selected?.rank || null,
    },
    tests,
    accuracyGraph,
    timePerQuestion,
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
    semester: filters.semester || undefined,
    academicYear: filters.academicYear || undefined,
    remarks: filters.remarks || undefined,
    logoUrl: filters.logoUrl || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value != null));
};

const resolveReportDownloadBasePath = (req, jobFilters = {}) => {
  const fromJob = typeof jobFilters.reportBasePath === "string" ? jobFilters.reportBasePath : "";
  if (fromJob.startsWith("/api/college-admin/reports") || fromJob.startsWith("/api/admin/reports")) {
    return fromJob;
  }

  if (String(req.baseUrl || "").startsWith("/api/college-admin/reports")) {
    return "/api/college-admin/reports";
  }

  return "/api/admin/reports";
};

const validateScopedFilters = async ({ db, type, filters, collegeId }) => {
  const rule = ENTITY_SCOPED_CHECKS[type];
  if (rule && filters?.[rule.key]) {
    const exists = await db[rule.model].findFirst({
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
  const m = await models.init();
  const db = m.dbClient;
  const filters = normalizeFilters(req.body.filters || {});
  const reportBasePath = resolveReportDownloadBasePath(req, filters);
  const adminDepartmentId = getScopedDepartmentId(req, { requiredForDepartmentAdmin: false });

  if (adminDepartmentId) {
    if (filters.departmentId && String(filters.departmentId) !== String(adminDepartmentId)) {
      return res.status(403).json({ message: "Cross-department report access denied" });
    }

    filters.departmentId = adminDepartmentId;

    if (filters.batchId) {
      const batch = await db.batch.findFirst({
        where: { id: filters.batchId, collegeId: req.collegeId, departmentId: adminDepartmentId },
        select: { id: true },
      });

      if (!batch) {
        return res.status(403).json({ message: "Batch is outside the admin department scope" });
      }
    }

    if (filters.studentId) {
      const student = await db.student.findFirst({
        where: { id: filters.studentId, collegeId: req.collegeId, departmentId: adminDepartmentId },
        select: { id: true },
      });

      if (!student) {
        return res.status(403).json({ message: "Student is outside the admin department scope" });
      }
    }

    if (filters.testId) {
      const scope = await buildAdminReportScope({
        db,
        req,
        filters: { testId: filters.testId, departmentId: adminDepartmentId, batchId: filters.batchId },
        testSelect: { id: true },
      });

      if (!scope.ok || scope.testIds.length === 0) {
        return res.status(403).json({ message: "Test is not accessible for this department" });
      }
    }
  }

  const validation = await validateScopedFilters({
    db,
    type: req.body.type,
    filters,
    collegeId: req.collegeId,
  });

  if (!validation.ok) {
    return res.status(validation.status).json({ message: validation.message });
  }

  const job = await db.reportJob.create({
    data: {
      type: req.body.type,
      filters: {
        ...filters,
        reportBasePath,
      },
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
  const m = await models.init();
  const db = m.dbClient;
  const jobs = await db.reportJob.findMany({
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
    delete filters.generatedDataRef;

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
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.reportJob.findFirst({
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

  const reportData = job.filters?.generatedDataRef
    ? await readReportPayload(job.filters.generatedDataRef)
    : job.filters?.generatedData || { rows: [] };

  const htmlContent = generateAdminReportHTML(
    {
      ...job,
      generatedAt: job.updatedAt,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    },
    reportData
  );

  const pdfBuffer = await renderHtmlToPdfBuffer(htmlContent, {
    displayHeaderFooter: true,
    footerTemplate:
      '<div style="width:100%;font-size:10px;color:#94a3b8;padding:0 10mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="report-${reportJobId}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(pdfBuffer);
});

const regenerateReportLink = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { reportJobId } = req.params;

  const job = await db.reportJob.findFirst({
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
  const reportBasePath = resolveReportDownloadBasePath(req, job.filters || {});
  const resultUrl = `${reportBasePath}/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

  const updated = await db.reportJob.update({
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
  const m = await models.init();
  const db = m.dbClient;
  const { testId, anomalyId, anomalyType, action, reason } = req.body;

  const test = await db.test.findFirst({
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

  await db.test.update({
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
  getReportSummaryDashboard,
  getReportChartsDashboard,
  getReportTableDashboard,
  getReportStudentDetailDashboard,
  downloadReport,
  regenerateReportLink,
  reviewAnomaly,
};
