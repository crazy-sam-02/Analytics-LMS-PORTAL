/**
 * Student Submission and Answer Controllers with Validation Integration
 * 
 * Integrates submission.service and answer.service for student test submissions.
 */

const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  createSubmission,
  updateSubmissionStatus,
  recordViolation,
  updateSubmissionMetadata,
} = require("../../services/submission.service");
const {
  saveAnswer,
  bulkSaveAnswers,
  markAnswerForReview,
  getSubmissionAnswers,
  calculateAccuracy,
} = require("../../services/answer.service");
const { getMetricsSnapshot } = require("../../services/validation-monitoring.service");

/**
 * Start a test submission
 */
const startSubmission = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const studentId = req.user.id;
  const collegeId = req.collegeId;
  const { testId } = req.body;

  if (!testId) {
    throw new ApiError(400, "Test ID is required");
  }

  try {
    const submission = await createSubmission(
      { testId },
      studentId,
      collegeId
    );

    // Get test questions
    const questions = await db.question.findMany({
      where: { testId },
      select: {
        id: true,
        prompt: true,
        type: true,
        marks: true,
        order: true,
      },
      orderBy: { order: "asc" },
    });

    res.status(201).json({
      success: true,
      submission: {
        id: submission.id,
        testId: submission.testId,
        status: submission.status,
        startedAt: submission.startedAt,
      },
      questions,
      message: "Submission started successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Save single answer with validation
 */
const saveAnswerHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const studentId = req.user.id;
  const collegeId = req.collegeId;
  const { submissionId } = req.params;

  try {
    const answer = await saveAnswer(
      req.body,
      submissionId,
      collegeId
    );

    res.status(200).json({
      success: true,
      answer,
      message: "Answer saved successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Bulk save answers (when submitting test)
 */
const bulkSaveAnswersHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const studentId = req.user.id;
  const collegeId = req.collegeId;
  const { submissionId } = req.params;

  if (!Array.isArray(req.body.answers)) {
    throw new ApiError(400, "Answers must be an array");
  }

  try {
    const result = await bulkSaveAnswers(
      req.body.answers,
      submissionId,
      collegeId
    );

    res.status(200).json({
      success: true,
      result,
      message: "Answers saved successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Mark answer for review
 */
const markAnswerForReviewHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const studentId = req.user.id;
  const collegeId = req.collegeId;
  const { submissionId, answerId } = req.params;
  const { markedForReview } = req.body;

  try {
    const answer = await markAnswerForReview(
      answerId,
      submissionId,
      collegeId,
      markedForReview
    );

    res.status(200).json({
      success: true,
      answer,
      message: `Answer ${markedForReview ? "marked" : "unmarked"} for review`,
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get all answers for submission
 */
const getAnswers = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { submissionId } = req.params;

  const answers = await getSubmissionAnswers(submissionId, collegeId);

  res.status(200).json({
    success: true,
    answers,
    count: answers.length,
  });
});

/**
 * Submit test (transition status to SUBMITTED)
 */
const submitTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { submissionId } = req.params;

  try {
    const submission = await updateSubmissionStatus(
      submissionId,
      "SUBMITTED",
      collegeId,
      "Student submission"
    );

    // Calculate accuracy
    const accuracy = await calculateAccuracy(submissionId, collegeId);

    res.status(200).json({
      success: true,
      submission: {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
        accuracy,
      },
      message: "Test submitted successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Record proctoring violation
 */
const recordProctoringViolation = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { submissionId } = req.params;

  if (!req.body.violationType) {
    throw new ApiError(400, "Violation type is required");
  }

  try {
    const submission = await recordViolation(
      submissionId,
      collegeId,
      req.body.violationType,
      req.body.metadata || {}
    );

    res.status(200).json({
      success: true,
      submission: {
        id: submission.id,
        violationCount: submission.violationCount,
        status: submission.status,
      },
      message: "Violation recorded",
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get submission metrics
 */
const getSubmissionMetrics = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const metrics = await getMetricsSnapshot();
  const submissionMetrics = metrics.failures?.SubmissionValidation || {};
  const answerMetrics = metrics.failures?.AnswerValidation || {};

  res.status(200).json({
    total_validations: metrics.summary.total,
    successful: metrics.summary.passed,
    failed: metrics.summary.failed,
    success_rate: metrics.summary.successRate,
    submission_failures: {
      count: submissionMetrics.count || 0,
      recent_errors: (submissionMetrics.errors || []).slice(0, 5),
    },
    answer_failures: {
      count: answerMetrics.count || 0,
      recent_errors: (answerMetrics.errors || []).slice(0, 5),
    },
    latency_ms: {
      submission: metrics.latency?.SubmissionValidation || {},
      answer: metrics.latency?.AnswerValidation || {},
    },
  });
});

module.exports = {
  startSubmission,
  saveAnswerHandler,
  bulkSaveAnswersHandler,
  markAnswerForReviewHandler,
  getAnswers,
  submitTest,
  recordProctoringViolation,
  getSubmissionMetrics,
};
