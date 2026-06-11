const express = require("express");
const db = require("../../config/db");
const env = require("../../config/env");
const { authenticate } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const { createRateLimiter, examWriteKey } = require("../../middleware/rate-limit");
const { ApiError } = require("../../utils/http");
const { bulkSaveAnswers } = require("../../services/answer.service");
const {
  listOngoingTests,
  getAttemptSession,
  getSession,
  heartbeatTest,
  saveAnswer,
  submitTest,
  reportViolation,
  getAttemptResult,
} = require("../../controllers/Students/tests.controller");
const {
  testIdOnlySchema,
  saveAnswerCompatSchema,
  submitCompatSchema,
  heartbeatCompatSchema,
  submitAttemptCompatSchema,
  violationCompatSchema,
  attemptAnswersCompatSchema,
  attemptIdOnlySchema,
} = require("../../schemas/Students/tests.schema");

const router = express.Router();

const examAnswerLimiter = createRateLimiter({
  scope: "student-exam-answer",
  routeLabel: "/api/answer",
  windowMs: env.rateLimit.examAnswerWindowMs,
  max: env.rateLimit.examAnswerMax,
  keySelector: examWriteKey,
  message: "Too many answer save requests in a short window. Please wait a moment.",
});

const examHeartbeatLimiter = createRateLimiter({
  scope: "student-exam-heartbeat",
  routeLabel: "/api/attempts/:attemptId/heartbeat",
  windowMs: env.rateLimit.examHeartbeatWindowMs,
  max: env.rateLimit.examHeartbeatMax,
  keySelector: examWriteKey,
  message: "Too many heartbeat requests in a short window. Please wait a moment.",
});

const examViolationLimiter = createRateLimiter({
  scope: "student-exam-violation",
  routeLabel: "/api/attempts/:attemptId/violations",
  windowMs: env.rateLimit.examViolationWindowMs,
  max: env.rateLimit.examViolationMax,
  keySelector: examWriteKey,
  message: "Too many violation reports in a short window. Please wait a moment.",
});

const examSubmitLimiter = createRateLimiter({
  scope: "student-exam-submit",
  routeLabel: "/api/attempts/:attemptId/submit",
  windowMs: env.rateLimit.examSubmitWindowMs,
  max: env.rateLimit.examSubmitMax,
  keySelector: examWriteKey,
  message: "Submission is already in progress. Please wait for it to complete.",
});

const examListLimiter = createRateLimiter({
  scope: "student-exam-list",
  routeLabel: "/api/attempts/active",
  windowMs: env.rateLimit.examListWindowMs,
  max: env.rateLimit.examListMax,
  message: "Too many test list requests in a short window. Please wait a moment.",
});

const examSessionLimiter = createRateLimiter({
  scope: "student-exam-session",
  routeLabel: "/api/attempts/:attemptId/session",
  windowMs: env.rateLimit.examSessionWindowMs,
  max: env.rateLimit.examSessionMax,
  keySelector: (req, actorIdentity) => {
    const attemptId = req.params?.attemptId || req.body?.attemptId || req.body?.submissionId || "unknown-attempt";
    const testId = req.params?.testId || req.body?.testId || "unknown-test";
    return `${actorIdentity}:attempt:${attemptId}:test:${testId}`;
  },
  message: "Too many session fetch requests in a short window. Please wait a moment.",
});

const loadOwnedAttempt = async (req) => {
  const submission = await db.submission.findUnique({ where: { id: req.params.attemptId } });
  const sameUser = submission?.userId === req.user?.id;
  const sameCollege = !req.user?.collegeId || !submission?.collegeId || submission.collegeId === req.user.collegeId;

  if (!submission || !sameUser || !sameCollege) {
    throw new ApiError(404, "Attempt not found", null, "ATTEMPT_NOT_FOUND");
  }

  return submission;
};

const attachAttemptToTestRequest = async (req, _res, next) => {
  try {
    const submission = await loadOwnedAttempt(req);

    req.params.testId = submission.testId;
    req.body = {
      ...req.body,
      submissionId: submission.id,
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

const saveAttemptAnswersCompat = async (req, res, next) => {
  try {
    const submission = await loadOwnedAttempt(req);
    const result = await bulkSaveAnswers(req.body.answers, submission.id, req.user.collegeId || submission.collegeId);

    return res.status(200).json({
      saved: true,
      success: true,
      result,
      message: "Answers saved successfully",
    });
  } catch (error) {
    return next(error);
  }
};

router.get("/attempts/active", authenticate, examListLimiter, listOngoingTests);
router.get("/attempts/:attemptId", authenticate, examSessionLimiter, validate(attemptIdOnlySchema), getAttemptSession);
router.patch("/attempts/:attemptId/answers", authenticate, examAnswerLimiter, validate(attemptAnswersCompatSchema), saveAttemptAnswersCompat);
router.patch("/attempts/:attemptId/heartbeat", authenticate, examHeartbeatLimiter, validate(heartbeatCompatSchema), attachAttemptToTestRequest, heartbeatTest);
router.post("/attempts/:attemptId/submit", authenticate, examSubmitLimiter, validate(submitAttemptCompatSchema), attachAttemptToTestRequest, submitTest);
router.post("/attempts/:attemptId/violations", authenticate, examViolationLimiter, validate(violationCompatSchema), attachAttemptToTestRequest, reportViolation);

router.get("/test/:testId", authenticate, examSessionLimiter, validate(testIdOnlySchema), getSession);
router.get("/results/:attemptId", authenticate, examSessionLimiter, validate(attemptIdOnlySchema), getAttemptResult);
router.get("/submission/:attemptId", authenticate, examSessionLimiter, validate(attemptIdOnlySchema), getAttemptResult);

router.post("/answer", authenticate, examAnswerLimiter, validate(saveAnswerCompatSchema), (req, _res, next) => {
  req.params.testId = req.body.testId;
  next();
}, saveAnswer);

router.post("/submit", authenticate, examSubmitLimiter, validate(submitCompatSchema), (req, _res, next) => {
  req.params.testId = req.body.testId;
  next();
}, submitTest);

module.exports = router;
