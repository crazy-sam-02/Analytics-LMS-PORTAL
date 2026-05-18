const models = require("../models");
const { redisClient, getRedisQueueConnection } = require("../config/redis");
const { emitToCollege } = require("../realtime/socket");

const inDateRange = (value, from, to) => {
  if (!value) return false;
  const when = new Date(value).getTime();
  if (!Number.isFinite(when)) return false;

  if (from && when < from.getTime()) return false;
  if (to && when > to.getTime()) return false;
  return true;
};

const buildSubmissionDateFilter = (filters = {}) => {
  const range = {};
  if (filters.dateFrom) {
    range.gte = new Date(filters.dateFrom);
  }
  if (filters.dateTo) {
    range.lte = new Date(filters.dateTo);
  }
  return Object.keys(range).length > 0 ? range : undefined;
};
const toScorePercent = (submission) => {
  const score = Number(submission?.score || 0);
  const totalMarks = Number(submission?.test?.totalMarks || 0);
  return Number((totalMarks > 0 ? (score / totalMarks) * 100 : score).toFixed(2));
};

const buildAnswerSignature = (answers = []) => {
  return answers
    .slice()
    .sort((a, b) => String(a.questionId || "").localeCompare(String(b.questionId || "")))
    .map((answer) => {
      const value = [
        answer?.selectedOption || "",
        answer?.answerText || "",
        typeof answer?.answerBoolean === "boolean" ? String(answer.answerBoolean) : "",
      ]
        .filter(Boolean)
        .join("|");
      return `${answer?.questionId || "unknown"}:${value}`;
    })
    .join(";");
};

const detectSubmissionAnomalies = ({ submissions, test }) => {
  const totalMarks = Number(test?.totalMarks || 0);
  const durationSeconds = Number(test?.durationMins || 0) * 60;

  const unusuallyFastHighScore = submissions
    .filter((item) => {
      if (!durationSeconds || !totalMarks) {
        return false;
      }
      const fastThreshold = durationSeconds * 0.2;
      const scoreThreshold = totalMarks * 0.85;
      return Number(item?.timeSpentSeconds || 0) <= fastThreshold && Number(item?.score || 0) >= scoreThreshold;
    })
    .map((item) => ({
      anomalyId: `FAST_HIGH_SCORE:${item.id}`,
      anomalyType: "UNUSUALLY_FAST_HIGH_SCORE",
      submissionId: item.id,
      studentId: item.userId,
      studentName: item.user?.fullName || "Student",
      score: item.score,
      timeSpentSeconds: item.timeSpentSeconds,
    }));

  const highViolationsHighScore = submissions
    .filter((item) => {
      if (!totalMarks) {
        return false;
      }
      const scoreThreshold = totalMarks * 0.9;
      return Number(item?.violationCount || 0) >= 3 && Number(item?.score || 0) >= scoreThreshold;
    })
    .map((item) => ({
      anomalyId: `VIOLATION_HIGH_SCORE:${item.id}`,
      anomalyType: "HIGH_VIOLATIONS_HIGH_SCORE",
      submissionId: item.id,
      studentId: item.userId,
      studentName: item.user?.fullName || "Student",
      score: item.score,
      violationCount: item.violationCount,
    }));

  const signatureMap = new Map();
  submissions.forEach((item) => {
    const signature = buildAnswerSignature(item.answers || []);
    if (!signature) {
      return;
    }

    const current = signatureMap.get(signature) || [];
    current.push(item);
    signatureMap.set(signature, current);
  });

  const identicalAnswerPatternPairs = [];
  signatureMap.forEach((items) => {
    if (items.length < 2) {
      return;
    }

    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        identicalAnswerPatternPairs.push({
          anomalyId: `IDENTICAL_PATTERN:${items[i].id}:${items[j].id}`,
          anomalyType: "IDENTICAL_ANSWER_PATTERN",
          leftSubmissionId: items[i].id,
          rightSubmissionId: items[j].id,
          leftStudentName: items[i].user?.fullName || "Student",
          rightStudentName: items[j].user?.fullName || "Student",
          similarityScore: 1,
        });
      }
    }
  });

  return {
    unusuallyFastHighScore,
    highViolationsHighScore,
    identicalAnswerPatternPairs,
    counts: {
      unusuallyFastHighScore: unusuallyFastHighScore.length,
      highViolationsHighScore: highViolationsHighScore.length,
      identicalAnswerPatternPairs: identicalAnswerPatternPairs.length,
    },
  };
};

let Queue = null;
let Worker = null;
try {
  ({ Queue, Worker } = require("bullmq"));
} catch (_error) {
  Queue = null;
  Worker = null;
}

let reportQueue = null;
let reportWorker = null;
const queueConnection = getRedisQueueConnection();

const getDbClient = async () => {
  const m = await models.init();
  return m.dbClient;
};

if (Queue && redisClient && queueConnection) {
  reportQueue = new Queue("admin-report-jobs", {
    connection: queueConnection,
  });

  reportWorker = new Worker(
    "admin-report-jobs",
    async (job) => {
      await processReportSynchronously(job.data.reportJobId);
    },
    {
      connection: queueConnection,
      concurrency: 8,
    }
  );

  reportWorker.on("failed", async (job, error) => {
    const reportJobId = job?.data?.reportJobId;
    if (!reportJobId) return;

    const db = await getDbClient();
    const reportJob = await db.reportJob.findUnique({ where: { id: reportJobId } });
    if (!reportJob) return;

    emitToCollege(reportJob.collegeId, "report:status", {
      reportJobId,
      status: "FAILED",
      errorMessage: error?.message || "Report processing failed",
    });
  });
}

const buildReportPayload = async (db, job) => {
  const filters = job.filters || {};
  const submissionDateFilter = buildSubmissionDateFilter(filters);

  if (job.type === "STUDENT_WISE") {
    const data = await db.submission.findMany({
      where: {
        collegeId: job.collegeId,
        ...(filters.studentId ? { userId: filters.studentId } : {}),
        ...(submissionDateFilter ? { submittedAt: submissionDateFilter } : {}),
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      },
      include: {
        user: {
          select: {
            fullName: true,
            studentId: true,
          },
        },
        test: {
          select: {
            title: true,
            subject: true,
            totalMarks: true,
          },
        },
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
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return data.map((row) => ({
      studentName: row.user.fullName,
      studentId: row.user.studentId,
      testName: row.test?.title,
      subject: row.test?.subject,
      date: row.submittedAt || row.updatedAt || row.createdAt,
      scorePercent: toScorePercent(row),
      percentile: row.percentile ?? null,
      timeTaken: Number(row.timeSpentSeconds || 0),
      violationsCount: Number(row.violationCount || row.violations?.length || 0),
      status: row.status || "-",
      violationEvents: (row.violations || []).map((violation) => ({
        testId: row.testId,
        anomalyId: violation.id,
        anomalyType: violation.type,
        createdAt: violation.createdAt,
        metadata: violation.metadata || null,
      })),
    }));
  }

  if (job.type === "TEST_WISE") {
    const tests = await db.test.findMany({
      where: {
        collegeId: job.collegeId,
        ...(filters.testId ? { id: filters.testId } : {}),
      },
      include: {
        submissions: {
          include: {
            answers: true,
            user: {
              select: {
                fullName: true,
                studentId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });

    return tests.map((test) => {
      const submissions = test.submissions || [];
      const filteredSubmissions = submissions.filter((item) => {
        if (submissionDateFilter && !inDateRange(item.submittedAt, submissionDateFilter.gte, submissionDateFilter.lte)) {
          return false;
        }
        if (filters.studentId && item.userId !== filters.studentId) {
          return false;
        }
        return true;
      });
      const participants = filteredSubmissions.length;
      const avgScore =
        participants > 0
          ? filteredSubmissions.reduce((acc, item) => acc + item.score, 0) / participants
          : 0;
      const avgAccuracy =
        participants > 0
          ? filteredSubmissions.reduce((acc, item) => acc + item.accuracy, 0) / participants
          : 0;
      const anomalies = detectSubmissionAnomalies({ submissions: filteredSubmissions, test });

      return {
        testId: test.id,
        testName: test.title,
        subject: test.subject,
        participants,
        avgScore: Number(avgScore.toFixed(2)),
        avgAccuracy: Number(avgAccuracy.toFixed(2)),
        anomalies,
        anomalyReviews: Array.isArray(test.anomalyReviews) ? test.anomalyReviews : [],
      };
    });
  }

  if (job.type === "DEPARTMENT_WISE") {
    const departments = await db.department.findMany({
      where: {
        collegeId: job.collegeId,
        ...(filters.departmentId ? { id: filters.departmentId } : {}),
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
      const students = filters.batchId
        ? department.students.filter((student) => {
            const mergedBatchIds = [...new Set([
              ...(Array.isArray(student.batchIds) ? student.batchIds : []),
              student.batchId,
            ].filter(Boolean))];
            return mergedBatchIds.some((id) => String(id) === String(filters.batchId));
          })
        : department.students;

      const allSubmissions = students
        .flatMap((student) => student.submissions)
        .filter((submission) => inDateRange(submission.submittedAt, submissionDateFilter?.gte, submissionDateFilter?.lte));
      const submissionsCount = allSubmissions.length;
      const avgScore =
        submissionsCount > 0
          ? allSubmissions.reduce((acc, item) => acc + item.score, 0) / submissionsCount
          : 0;
      const avgAccuracy =
        submissionsCount > 0
          ? allSubmissions.reduce((acc, item) => acc + item.accuracy, 0) / submissionsCount
          : 0;

      return {
        departmentId: department.id,
        departmentName: department.name,
        students: students.length,
        participationRate: students.length > 0 ? Number(((submissionsCount / students.length) * 100).toFixed(2)) : 0,
        avgScore: Number(avgScore.toFixed(2)),
        avgAccuracy: Number(avgAccuracy.toFixed(2)),
      };
    });
  }

  if (job.type === "COMPREHENSIVE") {
    const [tests, departments, batches, submissions] = await Promise.all([
      db.test.findMany({
        where: {
          collegeId: job.collegeId,
          ...(filters.testId ? { id: filters.testId } : {}),
        },
        select: {
          id: true,
          title: true,
          _count: {
            select: {
              submissions: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.department.findMany({
        where: {
          collegeId: job.collegeId,
          ...(filters.departmentId ? { id: filters.departmentId } : {}),
        },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              students: true,
            },
          },
        },
      }),
      db.batch.findMany({
        where: {
          collegeId: job.collegeId,
          ...(filters.batchId ? { id: filters.batchId } : {}),
        },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              students: true,
            },
          },
        },
      }),
      db.submission.findMany({
        where: {
          collegeId: job.collegeId,
          ...(filters.studentId ? { userId: filters.studentId } : {}),
          ...(filters.testId ? { testId: filters.testId } : {}),
          ...(submissionDateFilter ? { submittedAt: submissionDateFilter } : {}),
        },
        include: {
          user: {
            select: {
              fullName: true,
              studentId: true,
            },
          },
          test: {
            select: {
              title: true,
              subject: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);

    const totalSubmissions = submissions.length;
    const averageScore = totalSubmissions > 0
      ? Number((submissions.reduce((sum, item) => sum + item.score, 0) / totalSubmissions).toFixed(2))
      : 0;
    const averageAccuracy = totalSubmissions > 0
      ? Number((submissions.reduce((sum, item) => sum + item.accuracy, 0) / totalSubmissions).toFixed(2))
      : 0;

    return [
      {
        summary: {
          tests: tests.length,
          departments: departments.length,
          batches: batches.length,
          submissions: totalSubmissions,
          averageScore,
          averageAccuracy,
        },
        tests: tests.map((test) => ({
          testId: test.id,
          testName: test.title,
          participants: test._count.submissions,
        })),
        departments: departments.map((department) => ({
          departmentId: department.id,
          departmentName: department.name,
          students: department._count.students,
        })),
        batches: batches.map((batch) => ({
          batchId: batch.id,
          batchName: batch.name,
          students: batch._count.students,
        })),
        recentSubmissions: submissions.slice(0, 50).map((submission) => ({
          studentName: submission.user?.fullName,
          studentId: submission.user?.studentId,
          testName: submission.test?.title,
          score: submission.score,
          accuracy: submission.accuracy,
          submittedAt: submission.submittedAt,
        })),
      },
    ];
  }

  const batches = await db.batch.findMany({
    where: {
      collegeId: job.collegeId,
      ...(filters.batchId ? { id: filters.batchId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
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
    const allSubmissions = batch.students
      .flatMap((student) => {
        if (filters.studentId && String(student.id || "") !== String(filters.studentId)) {
          return [];
        }
        return student.submissions;
      })
      .filter((submission) => inDateRange(submission.submittedAt, submissionDateFilter?.gte, submissionDateFilter?.lte));
    const submissionsCount = allSubmissions.length;
    const avgScore =
      submissionsCount > 0
        ? allSubmissions.reduce((acc, item) => acc + item.score, 0) / submissionsCount
        : 0;

    return {
      batchId: batch.id,
      batchName: batch.name,
      students: batch.students.length,
      participationRate: batch.students.length > 0 ? Number(((submissionsCount / batch.students.length) * 100).toFixed(2)) : 0,
      avgScore: Number(avgScore.toFixed(2)),
    };
  });
};

const processReportSynchronously = async (reportJobId) => {
  const db = await getDbClient();
  const queued = await db.reportJob.update({
    where: { id: reportJobId },
    data: { status: "PROCESSING" },
  });

  emitToCollege(queued.collegeId, "report:status", {
    reportJobId,
    status: "PROCESSING",
  });

  try {
    const reportJob = await db.reportJob.findUnique({ where: { id: reportJobId } });
    const payload = await buildReportPayload(db, reportJob);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const resultUrl = `/api/admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

    await db.reportJob.update({
      where: { id: reportJobId },
      data: {
        status: "COMPLETED",
        resultUrl,
        filters: {
          ...(reportJob.filters || {}),
          generatedData: payload,
          resultUrlExpiresAt: expiresAt,
        },
      },
    });

    emitToCollege(reportJob.collegeId, "report:status", {
      reportJobId,
      status: "COMPLETED",
      resultUrl,
    });
  } catch (error) {
    const failed = await db.reportJob.update({
      where: { id: reportJobId },
      data: {
        status: "FAILED",
        errorMessage: error.message,
      },
    });

    emitToCollege(failed.collegeId, "report:status", {
      reportJobId,
      status: "FAILED",
      errorMessage: error.message,
    });
  }
};

const enqueueReportJob = async (reportJobId) => {
  if (!reportQueue) {
    await processReportSynchronously(reportJobId);
    return;
  }

  try {
    await reportQueue.add("generate", { reportJobId }, { removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    await processReportSynchronously(reportJobId);
  }
};

module.exports = {
  enqueueReportJob,
  processReportSynchronously,
};
