const models = require("../models");
const { redisClient, getRedisQueueConnection } = require("../config/redis");
const { emitToRole } = require("../realtime/socket");
const { saveReportPayload } = require("./report-payload-store.service");
const { clampPercent, getSubmissionScorePercent } = require("../utils/score");

let Queue = null;
let Worker = null;
try {
  ({ Queue, Worker } = require("bullmq"));
} catch (_error) {
  Queue = null;
  Worker = null;
}

let superReportQueue = null;
let superReportWorker = null;
const queueConnection = getRedisQueueConnection();
const DEFAULT_RECOVERY_LIMIT = 25;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

const getDbClient = async () => {
  const m = await models.init();
  return m.dbClient;
};

const toPercent = (value) => clampPercent(value);
const getScorePercent = getSubmissionScorePercent;
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";
const SUBMITTED_STATUSES = ["SUBMITTED", "AUTO_SUBMITTED"];

const getSubjectStatus = (avgScore) => {
  if (avgScore < 50) return "Needs Attention";
  if (avgScore < 70) return "Moderate";
  return "Good";
};

const resolveStudentYear = (student) => {
  const directYear = student?.year;
  if (directYear != null && directYear !== "") return directYear;
  return student?.batch?.academicYear || student?.batch?.year || "-";
};

const getDepartmentBatchIds = async (db, filters = {}) => {
  if (!filters.departmentId) return [];
  const batches = await db.batch.findMany({
    where: {
      departmentId: filters.departmentId,
      ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
    },
    select: { id: true },
  });
  return batches.map((batch) => batch.id);
};

const buildSubmissionDateFilter = (filters = {}) => {
  const range = {};
  if (filters.dateFrom) {
    range.gte = new Date(filters.dateFrom);
  }
  if (filters.dateTo) {
    range.lte = new Date(filters.dateTo);
  }
  return Object.keys(range).length > 0 ? range : null;
};

const buildSubmittedSubmissionWhere = (filters = {}, extra = {}) => {
  const dateFilter = buildSubmissionDateFilter(filters);
  return {
    status: { in: SUBMITTED_STATUSES },
    ...(dateFilter ? { submittedAt: dateFilter } : {}),
    ...extra,
  };
};

const buildTestWhere = (filters = {}, departmentBatchIds = []) => ({
  ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
  ...(filters.testId ? { id: filters.testId } : {}),
  ...(filters.departmentId
    ? {
        OR: [
          { departmentId: filters.departmentId },
          { assignedTo: { in: [filters.departmentId] } },
          ...(departmentBatchIds.length > 0
            ? [
                { batchId: { in: departmentBatchIds } },
                { batchAssignments: { some: { batchId: { in: departmentBatchIds } } } },
              ]
            : []),
        ],
      }
    : {}),
});

const buildDepartmentAcademicPayload = async (db, filters = {}) => {
  const [college, department, test, students, submissions] = await Promise.all([
    db.college.findUnique({
      where: { id: filters.collegeId },
      select: { id: true, name: true },
    }),
    db.department.findFirst({
      where: {
        id: filters.departmentId,
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      },
      select: { id: true, name: true },
    }),
    db.test.findFirst({
      where: {
        id: filters.testId,
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      },
      select: { id: true, title: true, subject: true, totalMarks: true },
    }),
    db.student.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        isActive: true,
      },
      include: {
        batch: { select: { name: true, year: true, academicYear: true } },
      },
    }),
    db.submission.findMany({
      where: buildSubmittedSubmissionWhere(filters, {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...(filters.testId ? { testId: filters.testId } : {}),
        ...(filters.departmentId ? { user: { departmentId: filters.departmentId } } : {}),
      }),
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            studentId: true,
            enrollNumber: true,
            enrollmentNumber: true,
            year: true,
            batch: { select: { name: true, year: true, academicYear: true } },
          },
        },
        test: { select: { id: true, title: true, subject: true, totalMarks: true } },
      },
    }),
  ]);

  const studentBest = new Map();
  submissions.forEach((submission) => {
    const studentId = submission.user?.id || submission.userId;
    if (!studentId) return;
    const scorePercent = getScorePercent(submission);
    const current = studentBest.get(studentId);
    if (!current || scorePercent > current.scorePercent) {
      studentBest.set(studentId, {
        studentId,
        name: submission.user?.fullName || "Student",
        email: submission.user?.email || "-",
        year: resolveStudentYear(submission.user),
        registerNumber: getStudentNumber(submission.user),
        scorePercent,
      });
    }
  });

  const totalStudents = students.length;
  const studentsAppeared = studentBest.size;
  const studentsNotAttended = Math.max(totalStudents - studentsAppeared, 0);
  const averageScore = studentsAppeared
    ? toPercent(Array.from(studentBest.values()).reduce((sum, row) => sum + row.scorePercent, 0) / studentsAppeared)
    : 0;
  const passedCount = Array.from(studentBest.values()).filter((row) => row.scorePercent >= 40).length;
  const failedCount = Math.max(studentsAppeared - passedCount, 0);
  const passPercent = studentsAppeared ? toPercent((passedCount / studentsAppeared) * 100) : 0;
  const subject = test?.subject || "General";

  return {
    meta: {
      departmentName: department?.name || "-",
      collegeName: college?.name || "-",
      testTitle: test?.title || "Selected Test",
      semester: filters.semester || "-",
      academicYear: filters.academicYear || "-",
      logoUrl: filters.logoUrl || "",
      hasSelectedTest: Boolean(filters.testId),
    },
    kpis: {
      totalStudents,
      studentsAppeared,
      studentsNotAttended,
      averageScore,
      passPercentage: passPercent,
    },
    subjectPerformance: [{ subject, averageScore }],
    passFail: {
      passPercent,
      failPercent: toPercent(100 - passPercent),
      passedCount,
      failedCount,
    },
    weakSubjects: [{ subject, averageScore, status: getSubjectStatus(averageScore) }],
    studentPerformance: Array.from(studentBest.values())
      .sort((a, b) => b.scorePercent - a.scorePercent)
      .map((row, index) => ({
        rank: index + 1,
        studentId: row.studentId,
        name: row.name,
        email: row.email,
        year: row.year,
        registerNumber: row.registerNumber,
        scorePercent: row.scorePercent,
      })),
    remarks: filters.remarks || "",
  };
};

if (Queue && redisClient && queueConnection) {
  superReportQueue = new Queue("super-admin-report-jobs", {
    connection: queueConnection,
  });

  superReportWorker = new Worker(
    "super-admin-report-jobs",
    async (job) => {
      await processSuperReportSynchronously(job.data.reportJobId);
    },
    {
      connection: queueConnection,
      concurrency: 8,
    }
  );

  superReportWorker.on("failed", (job, error) => {
    emitToRole("SUPER_ADMIN", "super-report:status", {
      reportJobId: job?.data?.reportJobId,
      status: "FAILED",
      errorMessage: error?.message || "Super report processing failed",
    });
  });
}

const buildGlobalReportPayload = async (db, job) => {
  const filters = job.filters || {};
  const departmentBatchIds = await getDepartmentBatchIds(db, filters);
  const scopedTests = filters.departmentId
    ? await db.test.findMany({
        where: buildTestWhere(filters, departmentBatchIds),
        select: { id: true },
      })
    : [];
  const scopedTestIds = scopedTests.map((test) => test.id);
  const scopedTestFilter = {
    ...(filters.testId ? { testId: filters.testId } : {}),
    ...(filters.departmentId ? { testId: { in: scopedTestIds } } : {}),
  };

  if (job.type === "STUDENT_WISE") {
    const rows = await db.submission.findMany({
      where: buildSubmittedSubmissionWhere(filters, {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...scopedTestFilter,
        ...(filters.studentId ? { userId: filters.studentId } : {}),
        ...(filters.departmentId ? { user: { departmentId: filters.departmentId } } : {}),
      }),
      include: {
        user: { select: { fullName: true, studentId: true, enrollNumber: true, enrollmentNumber: true, collegeId: true, department: { select: { name: true } } } },
        test: { select: { title: true, subject: true, totalMarks: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    return rows.map((row) => ({
      studentName: row.user.fullName,
      studentId: getStudentNumber(row.user),
      collegeId: row.user.collegeId,
      department: row.user.department?.name || "-",
      testName: row.test.title,
      subject: row.test.subject,
      score: getScorePercent(row),
      accuracy: getScorePercent(row),
      status: row.status,
      submittedAt: row.submittedAt,
    }));
  }

  if (job.type === "TEST_WISE") {
    const tests = await db.test.findMany({
      where: buildTestWhere(filters, departmentBatchIds),
      include: {
        submissions: {
          where: buildSubmittedSubmissionWhere(filters, {
            ...(filters.studentId ? { userId: filters.studentId } : {}),
            ...(filters.departmentId ? { user: { departmentId: filters.departmentId } } : {}),
          }),
        },
      },
      take: 500,
    });

    return tests.map((test) => {
      const participants = test.submissions.length;
      const avgScore = participants > 0 ? test.submissions.reduce((sum, item) => sum + getScorePercent({ ...item, test }), 0) / participants : 0;
      return {
        testId: test.id,
        testName: test.title,
        collegeId: test.collegeId,
        participants,
        avgScore: Number(avgScore.toFixed(2)),
      };
    });
  }

  if (job.type === "DEPARTMENT_WISE") {
    if (filters.testId && filters.departmentId && filters.collegeId) {
      return buildDepartmentAcademicPayload(db, filters);
    }

    const departments = await db.department.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
        ...(filters.departmentId ? { id: filters.departmentId } : {}),
      },
      include: {
        students: {
          where: {
            ...(filters.studentId ? { id: filters.studentId } : {}),
          },
          include: {
            submissions: {
              where: buildSubmittedSubmissionWhere(filters, scopedTestFilter),
              include: {
                test: { select: { totalMarks: true } },
              },
            },
          },
        },
      },
    });

    return departments.map((department) => {
      const submissions = department.students
        .flatMap((student) => student.submissions)
        .filter((submission) => !filters.testId || submission.testId === filters.testId)
        .filter((submission) => !filters.departmentId || scopedTestIds.includes(submission.testId));
      const avgScore = submissions.length > 0 ? submissions.reduce((sum, item) => sum + getScorePercent(item), 0) / submissions.length : 0;
      return {
        departmentId: department.id,
        departmentName: department.name,
        collegeId: department.collegeId,
        students: department.students.length,
        avgScore: Number(avgScore.toFixed(2)),
      };
    });
  }

  const batches = await db.batch.findMany({
    where: {
      ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    },
    include: {
      students: {
        where: {
          ...(filters.studentId ? { id: filters.studentId } : {}),
        },
        include: {
          submissions: {
            where: buildSubmittedSubmissionWhere(filters, scopedTestFilter),
            include: {
              test: { select: { totalMarks: true } },
            },
          },
        },
      },
    },
  });

  return batches.map((batch) => {
    const submissions = batch.students
      .flatMap((student) => student.submissions)
      .filter((submission) => !filters.testId || submission.testId === filters.testId)
      .filter((submission) => !filters.departmentId || scopedTestIds.includes(submission.testId));
    const avgScore = submissions.length > 0 ? submissions.reduce((sum, item) => sum + getScorePercent(item), 0) / submissions.length : 0;
    return {
      batchId: batch.id,
      batchName: batch.name,
      collegeId: batch.collegeId,
      students: batch.students.length,
      avgScore: Number(avgScore.toFixed(2)),
    };
  });
};

const processSuperReportSynchronously = async (reportJobId) => {
  const db = await getDbClient();
  await db.superReportJob.update({
    where: { id: reportJobId },
    data: { status: "PROCESSING" },
  });

  emitToRole("SUPER_ADMIN", "super-report:status", {
    reportJobId,
    status: "PROCESSING",
  });

  try {
    const reportJob = await db.superReportJob.findUnique({ where: { id: reportJobId } });
    const payload = await buildGlobalReportPayload(db, reportJob);
    const payloadRef = await saveReportPayload({ scope: "super-report", jobId: reportJobId, payload });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const resultUrl = `/api/super-admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

    await db.superReportJob.update({
      where: { id: reportJobId },
      data: {
        status: "COMPLETED",
        resultUrl,
        resultDataRef: payloadRef,
        filters: {
          ...(reportJob.filters || {}),
          resultUrlExpiresAt: expiresAt,
        },
      },
    });

    emitToRole("SUPER_ADMIN", "super-report:status", {
      reportJobId,
      status: "COMPLETED",
    });
  } catch (error) {
    await db.superReportJob.update({
      where: { id: reportJobId },
      data: {
        status: "FAILED",
        errorMessage: error.message,
      },
    });

    emitToRole("SUPER_ADMIN", "super-report:status", {
      reportJobId,
      status: "FAILED",
      errorMessage: error.message,
    });
  }
};

const enqueueSuperReportJob = async (reportJobId) => {
  if (!superReportQueue) {
    await processSuperReportSynchronously(reportJobId);
    return;
  }

  try {
    await superReportQueue.add("generate", { reportJobId }, { jobId: reportJobId, removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    await processSuperReportSynchronously(reportJobId);
  }
};

const recoverPendingSuperReportJobs = async ({ limit = DEFAULT_RECOVERY_LIMIT, staleAfterMs = STALE_PROCESSING_MS } = {}) => {
  const db = await getDbClient();
  const staleCutoff = new Date(Date.now() - staleAfterMs);
  const reset = await db.superReportJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: staleCutoff },
    },
    data: {
      status: "QUEUED",
      errorMessage: null,
    },
  });

  const queuedJobs = await db.superReportJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const job of queuedJobs) {
    await enqueueSuperReportJob(job.id);
  }

  return {
    resetProcessing: reset.count || 0,
    requeued: queuedJobs.length,
  };
};

module.exports = {
  buildGlobalReportPayload,
  enqueueSuperReportJob,
  processSuperReportSynchronously,
  recoverPendingSuperReportJobs,
};
