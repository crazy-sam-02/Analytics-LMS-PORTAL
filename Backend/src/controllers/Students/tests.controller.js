const prisma = require("../../config/db");
const { completeSubmission, calculateSubmissionScore } = require("../../services/test.service");
const { createAuditLog } = require("../../services/audit.service");
const { emitToCollege, emitToUser, emitToTestRoom } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");

const isSubmissionExpired = (submission) => {
  const durationMins = submission?.test?.durationMins;
  const startedAt = submission?.startedAt ? new Date(submission.startedAt).getTime() : 0;
  if (!durationMins || !startedAt) {
    return false;
  }

  return Date.now() > startedAt + durationMins * 60 * 1000;
};

const listOngoingTests = asyncHandler(async (req, res) => {
  const now = new Date();
  const tests = await prisma.test.findMany({
    where: {
      OR: [
        { batchId: req.user.batchId },
        {
          batchAssignments: {
            some: {
              batchId: req.user.batchId,
            },
          },
        },
      ],
      startsAt: { lte: now },
      endsAt: { gte: now },
      isPublished: true,
    },
    include: {
      questions: {
        select: { id: true },
      },
      submissions: {
        where: {
          userId: req.user.id,
        },
        orderBy: { updatedAt: "desc" },
        include: {
          answers: true,
          violations: true,
        },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  const payload = tests.map((test) => {
    const latestSubmission = test.submissions[0] || null;
    const attemptsUsed = test.submissions.length;
    const attemptsAllowed = Number(test.attemptsAllowed || 1);
    const attemptsRemaining = Math.max(attemptsAllowed - attemptsUsed, 0);
    const hasSubmitted = Boolean(latestSubmission && latestSubmission.status !== "IN_PROGRESS");
    const canTryAgain = hasSubmitted && attemptsRemaining > 0;
    const isCompleted = hasSubmitted && attemptsRemaining <= 0;

    const inProgressSubmission = latestSubmission?.status === "IN_PROGRESS" ? latestSubmission : null;
    const totalQuestions = test.questions?.length || 0;
    const answered = inProgressSubmission?.answers?.length || 0;

    const progress = inProgressSubmission
      ? totalQuestions > 0
        ? Math.floor((answered / totalQuestions) * 100)
        : 0
      : hasSubmitted
        ? 100
        : 0;

    return {
      ...test,
      progress,
      violationCount: inProgressSubmission?.violations?.length || 0,
      submissionId: inProgressSubmission?.id || null,
      latestSubmissionStatus: latestSubmission?.status || null,
      latestSubmissionId: latestSubmission?.id || null,
      attemptsUsed,
      attemptsAllowed,
      attemptsRemaining,
      canTryAgain,
      isCompleted,
    };
  });

  res.status(200).json(payload);
});

const listUpcomingTests = asyncHandler(async (req, res) => {
  const now = new Date();
  const tests = await prisma.test.findMany({
    where: {
      AND: [
        {
          OR: [
            { batchId: req.user.batchId },
            {
              batchAssignments: {
                some: {
                  batchId: req.user.batchId,
                },
              },
            },
          ],
        },
        {
          OR: [
            { isPublished: true },
            { status: "UPCOMING" },
          ],
        },
      ],
      startsAt: { gt: now },
    },
    orderBy: { startsAt: "asc" },
  });

  res.status(200).json(tests);
});

const startTest = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const userId = req.user.id;

  const test = await prisma.test.findUnique({
    where: { id: testId },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const now = new Date();
  if (test.startsAt > now || test.endsAt < now) {
    throw new ApiError(403, "Test is not active");
  }

  const existingSession = await prisma.testSession.findUnique({
    where: { userId_testId: { userId, testId } },
  });

  if (existingSession && !existingSession.endedAt && existingSession.expiresAt > now) {
    const submission = await prisma.submission.findUnique({
      where: { id: existingSession.submissionId },
      include: { answers: true, violations: true },
    });

    return res.status(200).json({
      resumed: true,
      submission,
      test: {
        ...test,
        questions: test.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          type: q.type,
          options: q.options,
          marks: q.marks,
          order: q.order,
        })),
      },
    });
  }

  const latestSubmission = await prisma.submission.findFirst({
    where: { userId, testId },
    orderBy: { attemptNumber: "desc" },
  });

  const currentAttemptCount = latestSubmission?.attemptNumber || 0;

  if (currentAttemptCount >= test.attemptsAllowed && latestSubmission?.status !== "IN_PROGRESS") {
    throw new ApiError(403, "Maximum attempts reached for this test");
  }

  const submission =
    latestSubmission?.status === "IN_PROGRESS"
      ? await prisma.submission.update({
          where: { id: latestSubmission.id },
          data: {
            startedAt: now,
            submittedAt: null,
            score: 0,
            accuracy: 0,
            timeSpentSeconds: 0,
          },
        })
      : await prisma.submission
          .create({
            data: {
              userId,
              testId,
              collegeId: req.user.collegeId,
              attemptNumber: currentAttemptCount + 1,
              status: "IN_PROGRESS",
              startedAt: now,
            },
          })
          .catch(async () => {
            // If two start requests race, use the latest in-progress submission.
            const inProgress = await prisma.submission.findFirst({
              where: {
                userId,
                testId,
                status: "IN_PROGRESS",
              },
              orderBy: { updatedAt: "desc" },
            });

            if (!inProgress) {
              throw new ApiError(409, "Unable to start test session", null, "SESSION_START_CONFLICT");
            }

            return inProgress;
          });

  await prisma.testSession.upsert({
    where: {
      userId_testId: { userId, testId },
    },
    update: {
      submissionId: submission.id,
      startedAt: now,
      expiresAt: new Date(now.getTime() + test.durationMins * 60 * 1000),
      endedAt: null,
    },
    create: {
      userId,
      testId,
      submissionId: submission.id,
      expiresAt: new Date(now.getTime() + test.durationMins * 60 * 1000),
    },
  });

  await createAuditLog({
    action: "STUDENT_TEST_SESSION_STARTED",
    targetType: "SUBMISSION",
    targetId: submission.id,
    collegeId: req.user.collegeId,
    testId,
    afterState: {
      status: submission.status,
      attemptNumber: submission.attemptNumber,
      startedAt: submission.startedAt,
    },
  });

  emitToUser(req.user.id, "test:session:started", {
    testId,
    submissionId: submission.id,
    attemptNumber: submission.attemptNumber,
    resumed: false,
  });
  emitToCollege(req.user.collegeId, "student_status_update", {
    testId,
    submissionId: submission.id,
    studentId: req.user.id,
    status: "IN_PROGRESS",
    progress: 0,
    connectionStatus: "ONLINE",
    violations: 0,
  });
  emitToTestRoom(testId, "student_status_update", {
    testId,
    submissionId: submission.id,
    studentId: req.user.id,
    status: "IN_PROGRESS",
    progress: 0,
    connectionStatus: "ONLINE",
    violations: 0,
  });

  res.status(200).json({
    resumed: false,
    submission,
    test: {
      ...test,
      questions: test.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options,
        marks: q.marks,
        order: q.order,
      })),
    },
  });
});

const getSession = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const userId = req.user.id;

  const submission = await prisma.submission.findFirst({
    where: {
      userId,
      testId,
      status: "IN_PROGRESS",
    },
    orderBy: { attemptNumber: "desc" },
    include: {
      answers: true,
      violations: true,
      test: {
        include: {
          questions: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  if (!submission) {
    throw new ApiError(404, "No existing session found");
  }

  res.status(200).json(submission);
});

const saveAnswer = asyncHandler(async (req, res) => {
  const { submissionId, questionId, selectedOption, answerText, answerBoolean, markedForReview } = req.body;

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { test: { select: { violationLimit: true, durationMins: true } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  if (isSubmissionExpired(submission)) {
    const completed = await completeSubmission({ submissionId, autoSubmitted: true });
    throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
  }

  const answer = await prisma.answer.upsert({
    where: {
      submissionId_questionId: {
        submissionId,
        questionId,
      },
    },
    update: {
      selectedOption: selectedOption ?? null,
      answerText: answerText ?? null,
      answerBoolean: typeof answerBoolean === "boolean" ? answerBoolean : null,
      markedForReview: Boolean(markedForReview),
    },
    create: {
      submissionId,
      questionId,
      selectedOption: selectedOption ?? null,
      answerText: answerText ?? null,
      answerBoolean: typeof answerBoolean === "boolean" ? answerBoolean : null,
      markedForReview: Boolean(markedForReview),
    },
  });

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      lastAutoSavedAt: new Date(),
    },
  });

  const [answerCount, questionCount, violationCount] = await Promise.all([
    prisma.answer.count({ where: { submissionId } }),
    prisma.question.count({ where: { testId: submission.testId } }),
    prisma.violation.count({ where: { submissionId } }),
  ]);
  const progress = questionCount > 0 ? Math.round((answerCount / questionCount) * 100) : 0;

  emitToCollege(req.user.collegeId, "student_status_update", {
    testId: submission.testId,
    submissionId,
    studentId: req.user.id,
    status: submission.status,
    progress,
    violations: violationCount,
    connectionStatus: "ONLINE",
  });
  emitToTestRoom(submission.testId, "student_status_update", {
    testId: submission.testId,
    submissionId,
    studentId: req.user.id,
    status: submission.status,
    progress,
    violations: violationCount,
    connectionStatus: "ONLINE",
  });

  res.status(200).json({ message: "Answer saved", answer });
});

const reportViolation = asyncHandler(async (req, res) => {
  const { submissionId, type, metadata } = req.body;

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { test: { select: { violationLimit: true, durationMins: true } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found", null, "SUBMISSION_NOT_FOUND");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  if (isSubmissionExpired(submission)) {
    const completed = await completeSubmission({ submissionId, autoSubmitted: true });
    return res.status(200).json({
      message: "Test time expired. Submission auto-submitted.",
      autoSubmitted: true,
      reason: "TEST_TIME_EXPIRED",
      submission: completed,
    });
  }

  await prisma.violation.create({
    data: {
      submissionId,
      type,
      metadata: metadata || null,
    },
  });

  const violationCount = await prisma.violation.count({ where: { submissionId } });

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      violationCount,
    },
  });

  await createAuditLog({
    action: "STUDENT_TEST_VIOLATION_REPORTED",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId: req.user.collegeId,
    testId: submission.testId,
    afterState: {
      type,
      violationCount,
      metadata: metadata || null,
    },
  });

  emitToUser(req.user.id, "test:violation", {
    submissionId,
    testId: submission.testId,
    type,
    violationCount,
    threshold: submission.test?.violationLimit || 3,
  });
  emitToCollege(req.user.collegeId, "test:violation:college", {
    submissionId,
    testId: submission.testId,
    userId: req.user.id,
    type,
    violationCount,
  });
  emitToCollege(req.user.collegeId, "violation_event", {
    submissionId,
    testId: submission.testId,
    studentId: req.user.id,
    type,
    violationCount,
    at: new Date().toISOString(),
  });
  emitToTestRoom(submission.testId, "violation_event", {
    submissionId,
    testId: submission.testId,
    studentId: req.user.id,
    type,
    violationCount,
    at: new Date().toISOString(),
  });
  emitToTestRoom(submission.testId, "student_status_update", {
    submissionId,
    testId: submission.testId,
    studentId: req.user.id,
    violations: violationCount,
    connectionStatus: "ONLINE",
  });

  if (violationCount >= (submission.test?.violationLimit || 3)) {
    const completed = await completeSubmission({ submissionId, autoSubmitted: true });
    return res.status(200).json({
      message: "Maximum violations reached. Test auto-submitted.",
      autoSubmitted: true,
      submission: completed,
    });
  }

  res.status(200).json({
    message: "Violation recorded",
    autoSubmitted: false,
    violationCount,
  });
});

const submitTest = asyncHandler(async (req, res) => {
  const { submissionId } = req.body;

  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found");
  }

  if (submission.status !== "IN_PROGRESS") {
    const summary = await calculateSubmissionScore(submissionId);
    return res.status(200).json({
      message: "Assessment already submitted",
      submission,
      summary,
      alreadySubmitted: true,
    });
  }

  const completed = await completeSubmission({ submissionId, autoSubmitted: false });
  const summary = await calculateSubmissionScore(submissionId);

  await createAuditLog({
    action: "STUDENT_TEST_SUBMITTED",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId: req.user.collegeId,
    testId: completed.testId,
    afterState: {
      status: completed.status,
      score: summary.score,
      accuracy: summary.accuracy,
      autoSubmitted: false,
    },
  });

  emitToUser(req.user.id, "test:submitted", {
    submissionId,
    testId: completed.testId,
    status: completed.status,
    score: summary.score,
    accuracy: summary.accuracy,
  });
  emitToCollege(req.user.collegeId, "test:submitted:college", {
    submissionId,
    testId: completed.testId,
    userId: req.user.id,
    status: completed.status,
  });
  emitToCollege(req.user.collegeId, "test_status_change", {
    testId: completed.testId,
    submissionId,
    studentId: req.user.id,
    status: completed.status,
    action: "ATTEMPT_SUBMITTED",
  });
  emitToTestRoom(completed.testId, "test_status_change", {
    testId: completed.testId,
    submissionId,
    studentId: req.user.id,
    status: completed.status,
    action: "ATTEMPT_SUBMITTED",
  });
  emitToTestRoom(completed.testId, "student_status_update", {
    testId: completed.testId,
    submissionId,
    studentId: req.user.id,
    status: completed.status,
    progress: 100,
    connectionStatus: "OFFLINE",
  });

  res.status(200).json({
    message: "Assessment submitted",
    submission: completed,
    summary,
  });
});

const getAttemptResult = asyncHandler(async (req, res) => {
  const attemptId = req.params.attemptId;

  const submission = await prisma.submission.findUnique({
    where: { id: attemptId },
    include: {
      test: {
        include: {
          questions: {
            orderBy: { order: "asc" },
          },
        },
      },
      answers: {
        include: {
          question: true,
        },
      },
    },
  });

  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Attempt not found", null, "ATTEMPT_NOT_FOUND");
  }

  if (submission.status === "IN_PROGRESS") {
    throw new ApiError(
      409,
      "Attempt is still in progress",
      { attempt_id: submission.id, test_id: submission.testId },
      "ATTEMPT_IN_PROGRESS"
    );
  }

  const [rankedScores, summary] = await Promise.all([
    prisma.submission.findMany({
      where: {
        testId: submission.testId,
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      },
      select: { score: true },
      orderBy: { score: "desc" },
    }),
    calculateSubmissionScore(submission.id),
  ]);

  const total = rankedScores.length || 1;
  const higherCount = rankedScores.filter((item) => Number(item.score || 0) > Number(summary.score || 0)).length;
  const percentile = Number((((total - higherCount) / total) * 100).toFixed(2));

  const answerByQuestionId = new Map(submission.answers.map((item) => [item.questionId, item]));
  const question_breakdown = (submission.test?.questions || []).map((question) => {
    const answer = answerByQuestionId.get(question.id);
    const studentAnswer = answer?.selectedOption ?? answer?.answerText ?? answer?.answerBoolean ?? "Not answered";
    const correctAnswer = question.correctOption ?? question.correctText ?? question.correctBoolean ?? "-";
    const isCorrect =
      answer &&
      ((question.type === "MCQ" && answer.selectedOption === question.correctOption) ||
        (question.type === "TRUE_FALSE" && answer.answerBoolean === question.correctBoolean) ||
        ((question.type === "FILL_BLANK" || question.type === "PARAGRAPH") &&
          String(answer.answerText || "").trim().toLowerCase() === String(question.correctText || "").trim().toLowerCase()));

    return {
      question_id: question.id,
      prompt: question.prompt,
      student_answer: studentAnswer,
      correct_answer: correctAnswer,
      marks: isCorrect ? Number(question.marks || 0) : 0,
      total_marks: Number(question.marks || 0),
      is_correct: Boolean(isCorrect),
      topic: "-",
    };
  });

  res.status(200).json({
    attempt_id: submission.id,
    submission_id: submission.id,
    test_id: submission.testId,
    score: Number(summary.score || submission.score || 0),
    percentile,
    time_taken: Number(submission.timeSpentSeconds || 0),
    review_mode: "show_after_deadline",
    submit_reason: submission.status === "AUTO_SUBMITTED" ? "AUTO_SUBMITTED" : "STUDENT_SUBMITTED",
    test: {
      id: submission.test?.id,
      title: submission.test?.title,
      subject: submission.test?.subject,
      end_date: submission.test?.endsAt,
    },
    question_breakdown,
  });
});

module.exports = {
  listOngoingTests,
  listUpcomingTests,
  startTest,
  getSession,
  saveAnswer,
  reportViolation,
  submitTest,
  getAttemptResult,
};
