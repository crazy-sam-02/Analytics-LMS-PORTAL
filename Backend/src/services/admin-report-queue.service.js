const models = require("../models");
const { redisClient, getRedisQueueConnection } = require("../config/redis");
const { emitToCollege } = require("../realtime/socket");
const { buildDepartmentReportPayload } = require("./admin-department-report.service");
const { saveReportPayload } = require("./report-payload-store.service");
const { getSubmissionScorePercent } = require("../utils/score");

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
const toScorePercent = getSubmissionScorePercent;

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

const buildReportPayload = async (db, job) => buildDepartmentReportPayload({ db, job });

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
    const payloadRef = await saveReportPayload({ scope: "admin-report", jobId: reportJobId, payload });
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const resultUrl = `/api/admin/reports/${reportJobId}/download?expires=${encodeURIComponent(expiresAt)}`;

    await db.reportJob.update({
      where: { id: reportJobId },
      data: {
        status: "COMPLETED",
        resultUrl,
        filters: {
          ...(reportJob.filters || {}),
          generatedDataRef: payloadRef,
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
