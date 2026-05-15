const models = require("../../models");
const { completeSubmission, calculateSubmissionScore } = require("../../services/test.service");
const { createAuditLog } = require("../../services/audit.service");
const { withRedisLock } = require("../../services/redis-lock.service");
const { setExamState, clearExamState } = require("../../services/exam-state-cache.service");
const { emitToCollege, emitToUser, emitToTestRoom } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getCachedTestQuestions, setCachedTestQuestions } = require("../../services/test-cache.service");
const { attachResolvedTestConfiguration } = require("../../services/test-config.service");
const {
  ASSIGNMENT_METHOD,
  buildStudentAssignmentScope,
  isStudentAssignedToTest,
} = require("../../services/student-test-assignment.service");

const HEARTBEAT_STALE_SECONDS = 20;
const HEARTBEAT_FORCE_AUTOSUBMIT_SECONDS = 15 * 60;

const getClientSessionId = (req) => {
  const fromHeader = req.headers["x-test-client-id"];
  const fromBody = req.body?.clientSessionId;
  const sessionId = String(fromHeader || fromBody || "").trim();
  return sessionId || null;
};

const isSubmissionExpired = (submission) => {
  const durationMins = submission?.test?.durationMins;
  const startedAt = submission?.startedAt ? new Date(submission.startedAt).getTime() : 0;
  if (!durationMins || !startedAt) {
    return false;
  }

  return Date.now() > startedAt + durationMins * 60 * 1000;
};

const heartbeatAgeSeconds = (lastHeartbeatAt) => {
  if (!lastHeartbeatAt) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(lastHeartbeatAt).getTime();
  return Math.max(0, Math.floor(ms / 1000));
};

const assertSessionOwnership = async ({ db, req, userId, testId, submissionId }) => {
  const session = await db.testSession.findUnique({
    where: { userId_testId: { userId, testId } },
  });

  if (!session || session.endedAt) {
    throw new ApiError(409, "No active test session", null, "NO_ACTIVE_SESSION");
  }

  if (submissionId && String(session.submissionId) !== String(submissionId)) {
    throw new ApiError(409, "Submission does not match active session", null, "SESSION_SUBMISSION_MISMATCH");
  }

  const clientSessionId = getClientSessionId(req);
  if (session.clientSessionId && clientSessionId && String(session.clientSessionId) !== String(clientSessionId)) {
    // Allow device/tab takeover for the same authenticated student.
    await db.testSession.updateMany({
      where: {
        userId,
        testId,
        endedAt: null,
      },
      data: {
        clientSessionId,
        connectionStatus: "ONLINE",
        lastHeartbeatAt: new Date(),
      },
    });

    session.clientSessionId = clientSessionId;
  }

  return { session, clientSessionId };
};

const upsertSessionHeartbeat = async ({ db, userId, testId, submissionId, clientSessionId }) => {
  const heartbeatAt = new Date();
  await db.testSession.updateMany({
    where: {
      userId,
      testId,
      endedAt: null,
    },
    data: {
      submissionId,
      lastHeartbeatAt: heartbeatAt,
      connectionStatus: "ONLINE",
      ...(clientSessionId ? { clientSessionId } : {}),
    },
  });

  await db.submission.updateMany({
    where: { id: submissionId },
    data: {
      lastHeartbeat: heartbeatAt,
      connectionStatus: "ONLINE",
    },
  });
};

const listOngoingTests = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const now = new Date();
  const tests = await db.test.findMany({
    where: {
      ...buildStudentAssignmentScope(req.user),
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
    const resolvedTest = attachResolvedTestConfiguration(test);
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
      ...resolvedTest,
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
  const m = await models.init();
  const db = m.dbClient;
  const now = new Date();
  const tests = await db.test.findMany({
    where: {
      AND: [
        buildStudentAssignmentScope(req.user),
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

  res.status(200).json(tests.map((test) => attachResolvedTestConfiguration(test)));
});

const startTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const userId = req.user.id;
  const clientSessionId = getClientSessionId(req);

  return withRedisLock({
    lockKey: `lock:test-start:user:${userId}:test:${testId}`,
    ttlMs: 10_000,
    waitTimeoutMs: 2_000,
    onLockTimeout: async () => {
      const test = await db.test.findUnique({
        where: { id: testId },
        include: { questions: { orderBy: { order: "asc" } } },
      });

      if (!test) {
        throw new ApiError(404, "Test not found");
      }

      const existingSession = await db.testSession.findUnique({
        where: { userId_testId: { userId, testId } },
      });

      if (existingSession && !existingSession.endedAt) {
        const submission = await db.submission.findUnique({
          where: { id: existingSession.submissionId },
          include: { answers: true, violations: true },
        });

        if (submission && submission.status === "IN_PROGRESS") {
          let cachedQuestions = await getCachedTestQuestions(testId);
          if (!cachedQuestions) {
            cachedQuestions = test.questions.map((q) => ({
              id: q.id,
              prompt: q.prompt,
              type: q.type,
              options: q.options,
              marks: q.marks,
              order: q.order,
            }));
            await setCachedTestQuestions(testId, cachedQuestions);
          }

          const hydratedTest = attachResolvedTestConfiguration({
            ...test,
            questions: cachedQuestions,
          });

          return res.status(200).json({
            resumed: true,
            serverTime: Date.now(),
            server_end_time: new Date(existingSession.expiresAt).getTime(),
            test_type: hydratedTest.test_type,
            proctoring_config: hydratedTest.proctoring_config,
            question_order: Array.isArray(cachedQuestions)
              ? cachedQuestions.map((question) => question.id).filter(Boolean)
              : [],
            questions: cachedQuestions,
            session: {
              connectionStatus:
                heartbeatAgeSeconds(existingSession.lastHeartbeatAt) > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
            },
            submission,
            test: hydratedTest,
          });
        }
      }

      throw new ApiError(429, "Another start request is in progress. Please retry.", null, "SESSION_START_LOCKED");
    },
    task: async () => {

  const test = await db.test.findUnique({
    where: { id: testId },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  // Build sanitized question list for student view (no correct answers).
  // Cache it so 500+ concurrent startTest requests don't all hit MongoDB.
  let cachedQuestions = await getCachedTestQuestions(testId);
  if (!cachedQuestions) {
    cachedQuestions = test.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      options: q.options,
      marks: q.marks,
      order: q.order,
    }));
    await setCachedTestQuestions(testId, cachedQuestions);
  }

  const now = new Date();
  if (test.startsAt > now || test.endsAt < now) {
    throw new ApiError(403, "Test is not active");
  }

  const assignedViaMapping = await db.testBatch.findFirst({
    where: {
      testId,
      batchId: { in: req.user.batchIds || [] },
    },
  });
  if (!isStudentAssignedToTest({
    test,
    student: req.user,
    hasBatchAssignment: Boolean(assignedViaMapping),
  })) {
    throw new ApiError(403, "Student is not assigned to this test", null, "TEST_NOT_ASSIGNED");
  }

  const existingSession = await db.testSession.findUnique({
    where: { userId_testId: { userId, testId } },
  });

  if (existingSession && !existingSession.endedAt) {
    const submission = await db.submission.findUnique({
      where: { id: existingSession.submissionId },
      include: { answers: true, violations: true },
    });

    if (!submission) {
      // Stale session without a valid submission - clean it up and allow fresh start.
      await db.testSession.updateMany({
        where: { userId, testId, endedAt: null },
        data: { endedAt: now, connectionStatus: "OFFLINE" },
      });
      await clearExamState({ userId, testId });
      // Fall through to create a new session below.
    } else {
      const sessionExpired = new Date(existingSession.expiresAt) <= now;
      const forceAutoSubmit = heartbeatAgeSeconds(existingSession.lastHeartbeatAt) > HEARTBEAT_FORCE_AUTOSUBMIT_SECONDS;

      if (submission.status !== "IN_PROGRESS") {
        await db.testSession.updateMany({
          where: { userId, testId, endedAt: null },
          data: { endedAt: now, connectionStatus: "OFFLINE" },
        });
        await clearExamState({ userId, testId });
        // Fall through to create a new session below.
      } else if (sessionExpired || forceAutoSubmit) {
        // Auto-submit stale or expired attempts so they cannot be reopened.
        await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
        await db.testSession.updateMany({
          where: { userId, testId, endedAt: null },
          data: { endedAt: now, connectionStatus: "OFFLINE" },
        });
        await clearExamState({ userId, testId });
        // Fall through to create a new session below.
      } else {
        // Valid active session - resume it.
        await upsertSessionHeartbeat({
          db,
          userId,
          testId,
          submissionId: submission.id,
          clientSessionId,
        });

        await setExamState({
          userId,
          testId,
          state: {
            submissionId: submission.id,
            status: submission.status,
            lastHeartbeatAt: new Date(),
            connectionStatus: "ONLINE",
          },
        });

        const hydratedTest = attachResolvedTestConfiguration({
          ...test,
          questions: cachedQuestions,
        });

        return res.status(200).json({
          resumed: true,
          serverTime: Date.now(),
          server_end_time: new Date(existingSession.expiresAt).getTime(),
          test_type: hydratedTest.test_type,
          proctoring_config: hydratedTest.proctoring_config,
          question_order: Array.isArray(cachedQuestions) ? cachedQuestions.map((question) => question.id).filter(Boolean) : [],
          questions: cachedQuestions,
          session: {
            connectionStatus:
              heartbeatAgeSeconds(existingSession.lastHeartbeatAt) > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
          },
          submission,
          test: hydratedTest,
        });
      }
    }
  }

  const latestSubmission = await db.submission.findFirst({
    where: { userId, testId },
    orderBy: { attemptNumber: "desc" },
  });

  const currentAttemptCount = latestSubmission?.attemptNumber || 0;

  if (currentAttemptCount >= test.attemptsAllowed && latestSubmission?.status !== "IN_PROGRESS") {
    throw new ApiError(403, "Maximum attempts reached for this test");
  }

  const submission =
    latestSubmission?.status === "IN_PROGRESS"
      ? await db.submission.update({
          where: { id: latestSubmission.id },
          data: {
            startedAt: now,
            submittedAt: null,
            score: 0,
            accuracy: 0,
            timeSpentSeconds: 0,
          },
        })
      : await db.submission
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
            const inProgress = await db.submission.findFirst({
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

  await db.testSession.upsert({
    where: {
      userId_testId: { userId, testId },
    },
    update: {
      submissionId: submission.id,
      startedAt: now,
      expiresAt: new Date(now.getTime() + test.durationMins * 60 * 1000),
      endedAt: null,
      lastHeartbeatAt: now,
      connectionStatus: "ONLINE",
      ...(clientSessionId ? { clientSessionId } : {}),
    },
    create: {
      userId,
      testId,
      submissionId: submission.id,
      expiresAt: new Date(now.getTime() + test.durationMins * 60 * 1000),
      lastHeartbeatAt: now,
      connectionStatus: "ONLINE",
      ...(clientSessionId ? { clientSessionId } : {}),
    },
  });

  await db.submission.updateMany({
    where: { id: submission.id },
    data: {
      lastHeartbeat: now,
      connectionStatus: "ONLINE",
    },
  });

  await setExamState({
    userId,
    testId,
    state: {
      submissionId: submission.id,
      status: submission.status,
      lastHeartbeatAt: now,
      connectionStatus: "ONLINE",
      progress: 0,
      violationCount: 0,
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

      const hydratedTest = attachResolvedTestConfiguration({
        ...test,
        questions: cachedQuestions,
      });

      return res.status(200).json({
        resumed: false,
        serverTime: Date.now(),
        server_end_time: new Date(now.getTime() + test.durationMins * 60 * 1000).getTime(),
        test_type: hydratedTest.test_type,
        proctoring_config: hydratedTest.proctoring_config,
        question_order: Array.isArray(cachedQuestions) ? cachedQuestions.map((question) => question.id).filter(Boolean) : [],
        questions: cachedQuestions,
        submission,
        test: hydratedTest,
      });
    },
  });
});

const getSession = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const userId = req.user.id;

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId,
    testId,
  });

  const submission = await db.submission.findFirst({
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

  if (isSubmissionExpired(submission)) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    throw new ApiError(409, "Test time expired. Submission auto-submitted.", { submission: completed }, "TEST_TIME_EXPIRED");
  }

  const idleSeconds = heartbeatAgeSeconds(session.lastHeartbeatAt);
  if (idleSeconds > HEARTBEAT_FORCE_AUTOSUBMIT_SECONDS) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    throw new ApiError(
      409,
      "Session expired due to inactivity. Submission auto-submitted.",
      { submission: completed },
      "SESSION_INACTIVITY_AUTOSUBMITTED"
    );
  }

  await upsertSessionHeartbeat({
    db,
    userId,
    testId,
    submissionId: submission.id,
    clientSessionId,
  });

  await setExamState({
    userId,
    testId,
    state: {
      submissionId: submission.id,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      connectionStatus: idleSeconds > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
    },
  });

  const hydratedTest = attachResolvedTestConfiguration(submission.test);

  res.status(200).json({
    ...submission,
    test: hydratedTest,
    serverTime: Date.now(),
    server_end_time: new Date(session.expiresAt).getTime(),
    test_type: hydratedTest?.test_type || null,
    proctoring_config: hydratedTest?.proctoring_config || null,
    session: {
      connectionStatus: idleSeconds > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
      lastHeartbeatAt: session.lastHeartbeatAt,
    },
  });
});

const getAttemptSession = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { attemptId } = req.params;
  const submission = await db.submission.findUnique({
    where: { id: attemptId },
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

  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Attempt not found", null, "ATTEMPT_NOT_FOUND");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Attempt already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  const session = await db.testSession.findUnique({
    where: { userId_testId: { userId: req.user.id, testId: submission.testId } },
  });

  if (!session || session.endedAt) {
    throw new ApiError(409, "No active session for attempt", null, "NO_ACTIVE_SESSION");
  }

  const hydratedTest = attachResolvedTestConfiguration(submission.test);

  res.status(200).json({
    ...submission,
    test: hydratedTest,
    serverTime: Date.now(),
    server_end_time: new Date(session.expiresAt).getTime(),
    attempt_id: submission.id,
    test_id: submission.testId,
    test_type: hydratedTest?.test_type || null,
    proctoring_config: hydratedTest?.proctoring_config || null,
    question_order: Array.isArray(hydratedTest?.questions) ? hydratedTest.questions.map((question) => question.id).filter(Boolean) : [],
    questions: Array.isArray(hydratedTest?.questions) ? hydratedTest.questions : [],
    session: {
      connectionStatus: heartbeatAgeSeconds(session.lastHeartbeatAt) > HEARTBEAT_STALE_SECONDS ? "DISCONNECTED" : "ONLINE",
      lastHeartbeatAt: session.lastHeartbeatAt,
    },
  });
});

const heartbeatTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { submissionId } = req.body;
  const userId = req.user.id;

  const { session, clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId,
    testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
    where: { id: session.submissionId },
    include: { test: { select: { durationMins: true } } },
  });

  if (!submission || submission.userId !== userId) {
    throw new ApiError(404, "Submission not found", null, "SUBMISSION_NOT_FOUND");
  }

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  if (isSubmissionExpired(submission)) {
    const completed = await completeSubmission({ submissionId: submission.id, autoSubmitted: true });
    return res.status(200).json({
      ok: false,
      autoSubmitted: true,
      reason: "TEST_TIME_EXPIRED",
      submission: completed,
    });
  }

  await upsertSessionHeartbeat({
    db,
    userId,
    testId,
    submissionId: submission.id,
    clientSessionId,
  });

  await setExamState({
    userId,
    testId,
    state: {
      submissionId: submission.id,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      connectionStatus: "ONLINE",
    },
  });

  res.status(200).json({
    ok: true,
    submissionId: submission.id,
    serverTime: Date.now(),
    server_end_time: new Date(session.expiresAt).getTime(),
  });
});


const saveAnswer = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const {
    submissionId,
    questionId,
    selectedOption,
    selectedOptions,
    answerText,
    answerBoolean,
    markedForReview,
  } = req.body;

  const { clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId: req.user.id,
    testId: req.params.testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
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

  await upsertSessionHeartbeat({
    db,
    userId: req.user.id,
    testId: submission.testId,
    submissionId,
    clientSessionId,
  });

  const answer = await db.answer.upsert({
    where: {
      submissionId_questionId: {
        submissionId,
        questionId,
      },
    },
    update: {
      selectedOption: selectedOption ?? null,
      selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
      answerText: answerText ?? null,
      answerBoolean: typeof answerBoolean === "boolean" ? answerBoolean : null,
      markedForReview: Boolean(markedForReview),
    },
    create: {
      submissionId,
      questionId,
      selectedOption: selectedOption ?? null,
      selectedOptions: Array.isArray(selectedOptions) ? selectedOptions : [],
      answerText: answerText ?? null,
      answerBoolean: typeof answerBoolean === "boolean" ? answerBoolean : null,
      markedForReview: Boolean(markedForReview),
    },
  });

  await db.submission.update({
    where: { id: submissionId },
    data: {
      lastAutoSavedAt: new Date(),
    },
  });

  const [answerCount, questionCount, violationCount] = await Promise.all([
    db.answer.count({ where: { submissionId } }),
    db.question.count({ where: { testId: submission.testId } }),
    db.violation.count({ where: { submissionId } }),
  ]);
  const progress = questionCount > 0 ? Math.round((answerCount / questionCount) * 100) : 0;

  await setExamState({
    userId: req.user.id,
    testId: submission.testId,
    state: {
      submissionId,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      lastAutoSavedAt: new Date(),
      connectionStatus: "ONLINE",
      progress,
      violationCount,
    },
  });

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
  const m = await models.init();
  const db = m.dbClient;
  const { submissionId, type, metadata } = req.body;

  const { clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId: req.user.id,
    testId: req.params.testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
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

  await upsertSessionHeartbeat({
    db,
    userId: req.user.id,
    testId: submission.testId,
    submissionId,
    clientSessionId,
  });

  await db.violation.create({
    data: {
      submissionId,
      type,
      metadata: metadata || null,
    },
  });

  const violationCount = await db.violation.count({ where: { submissionId } });

  await db.submission.update({
    where: { id: submissionId },
    data: {
      violationCount,
    },
  });

  const [answerCountForState, questionCountForState] = await Promise.all([
    db.answer.count({ where: { submissionId } }),
    db.question.count({ where: { testId: submission.testId } }),
  ]);
  const progressForState = questionCountForState > 0
    ? Math.round((answerCountForState / questionCountForState) * 100)
    : 0;

  await setExamState({
    userId: req.user.id,
    testId: submission.testId,
    state: {
      submissionId,
      status: submission.status,
      lastHeartbeatAt: new Date(),
      connectionStatus: "ONLINE",
      progress: progressForState,
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
  const m = await models.init();
  const db = m.dbClient;
  const { submissionId } = req.body;

  return withRedisLock({
    lockKey: `lock:test-submit:submission:${submissionId || "unknown"}`,
    ttlMs: 8_000,
    waitTimeoutMs: 2_000,
    onLockTimeout: async () => {
      const submission = await db.submission.findUnique({
        where: { id: submissionId },
      });

      if (submission && submission.userId === req.user.id && submission.status !== "IN_PROGRESS") {
        const summary = await calculateSubmissionScore(submissionId);
        await clearExamState({ userId: req.user.id, testId: submission.testId });
        return res.status(200).json({
          message: "Assessment already submitted",
          submission,
          summary,
          alreadySubmitted: true,
        });
      }

      return res.status(202).json({
        message: "Submission is already being processed",
        submission: submission || { id: submissionId },
        inProgress: true,
      });
    },
    task: async () => {

  const { clientSessionId } = await assertSessionOwnership({
    db,
    req,
    userId: req.user.id,
    testId: req.params.testId,
    submissionId,
  });

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { test: { select: { durationMins: true } } },
  });
  if (!submission || submission.userId !== req.user.id) {
    throw new ApiError(404, "Submission not found");
  }

  await upsertSessionHeartbeat({
    db,
    userId: req.user.id,
    testId: submission.testId,
    submissionId,
    clientSessionId,
  });

      if (isSubmissionExpired(submission)) {
        const completed = await completeSubmission({ submissionId, autoSubmitted: true });
        const summaryExpired = await calculateSubmissionScore(submissionId);
        await clearExamState({ userId: req.user.id, testId: submission.testId });
        return res.status(200).json({
          message: "Assessment submitted automatically because time expired",
          submission: completed,
          summary: summaryExpired,
          autoSubmitted: true,
          reason: "TEST_TIME_EXPIRED",
        });
      }

      if (submission.status !== "IN_PROGRESS") {
        const summary = await calculateSubmissionScore(submissionId);
        await clearExamState({ userId: req.user.id, testId: submission.testId });
        return res.status(200).json({
          message: "Assessment already submitted",
          submission,
          summary,
          alreadySubmitted: true,
        });
      }

      const completed = await completeSubmission({ submissionId, autoSubmitted: false });
      const summary = await calculateSubmissionScore(submissionId);
      await clearExamState({ userId: req.user.id, testId: completed.testId });

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

      return res.status(200).json({
        message: "Assessment submitted",
        submission: completed,
        summary,
      });
    },
  });
});

const getAttemptResult = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const attemptId = req.params.attemptId;

  const submission = await db.submission.findUnique({
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
    db.submission.findMany({
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
  const hydratedTest = attachResolvedTestConfiguration(submission.test);

  const answerByQuestionId = new Map(submission.answers.map((item) => [item.questionId, item]));
  const question_breakdown = (submission.test?.questions || []).map((question) => {
    const answer = answerByQuestionId.get(question.id);
    const studentAnswer =
      (Array.isArray(answer?.selectedOptions) && answer.selectedOptions.length > 0
        ? answer.selectedOptions
        : answer?.selectedOption) ??
      answer?.answerText ??
      answer?.answerBoolean ??
      "Not answered";
    const correctAnswer =
      (Array.isArray(question.correctOptions) && question.correctOptions.length > 0
        ? question.correctOptions
        : question.correctOption) ??
      question.correctText ??
      question.correctBoolean ??
      "-";
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
      id: hydratedTest?.id,
      title: hydratedTest?.title,
      subject: hydratedTest?.subject,
      end_date: hydratedTest?.endsAt,
      test_type: hydratedTest?.test_type || null,
      proctoring_preset: hydratedTest?.proctoring_preset || null,
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
  heartbeatTest,
  reportViolation,
  submitTest,
  getAttemptSession,
  getAttemptResult,
};
