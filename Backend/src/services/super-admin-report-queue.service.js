const models = require("../models");
const { redisClient, getRedisQueueConnection } = require("../config/redis");
const { emitToRole } = require("../realtime/socket");

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

const buildGlobalReportPayload = async (job) => {
  const filters = job.filters || {};

  if (job.type === "STUDENT_WISE") {
    const rows = await db.submission.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      },
      include: {
        user: { select: { fullName: true, studentId: true, collegeId: true } },
        test: { select: { title: true, subject: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    return rows.map((row) => ({
      studentName: row.user.fullName,
      studentId: row.user.studentId,
      collegeId: row.user.collegeId,
      testName: row.test.title,
      subject: row.test.subject,
      score: row.score,
      accuracy: row.accuracy,
      status: row.status,
      submittedAt: row.submittedAt,
    }));
  }

  if (job.type === "TEST_WISE") {
    const tests = await db.test.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      },
      include: {
        submissions: true,
      },
      take: 500,
    });

    return tests.map((test) => {
      const participants = test.submissions.length;
      const avgScore = participants > 0 ? test.submissions.reduce((sum, item) => sum + item.score, 0) / participants : 0;
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
    const departments = await db.department.findMany({
      where: {
        ...(filters.collegeId ? { collegeId: filters.collegeId } : {}),
      },
      include: {
        students: {
          include: {
            submissions: true,
          },
        },
      },
    });

    return departments.map((department) => {
      const submissions = department.students.flatMap((student) => student.submissions);
      const avgScore = submissions.length > 0 ? submissions.reduce((sum, item) => sum + item.score, 0) / submissions.length : 0;
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
    },
    include: {
      students: {
        include: {
          submissions: true,
        },
      },
    },
  });

  return batches.map((batch) => {
    const submissions = batch.students.flatMap((student) => student.submissions);
    const avgScore = submissions.length > 0 ? submissions.reduce((sum, item) => sum + item.score, 0) / submissions.length : 0;
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
    const payload = await buildGlobalReportPayload(reportJob);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const resultUrl = `/api/super-admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

    await db.superReportJob.update({
      where: { id: reportJobId },
      data: {
        status: "COMPLETED",
        resultUrl,
        resultData: payload,
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
    await superReportQueue.add("generate", { reportJobId }, { removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    await processSuperReportSynchronously(reportJobId);
  }
};

module.exports = {
  enqueueSuperReportJob,
  processSuperReportSynchronously,
};
