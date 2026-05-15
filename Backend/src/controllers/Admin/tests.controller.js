const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { completeSubmission } = require("../../services/test.service");
const { emitToCollege, emitToTestRoom } = require("../../realtime/socket");
const { ApiError, asyncHandler } = require("../../utils/http");
const { invalidateTestCache } = require("../../services/test-cache.service");
const { getExamRateLimitMetricsSnapshot } = require("../../services/rate-limit-metrics.service");
const {
  attachResolvedTestConfiguration,
  resolvePersistedTestConfiguration,
} = require("../../services/test-config.service");
const { cloneTestWithinCollege } = require("../../services/clone.service");

const TEST_STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
};

const LEGACY_STATUS = {
  PUBLISHED: "PUBLISHED",
  UPCOMING: "UPCOMING",
};

const TRANSITION_ACTION = {
  SCHEDULE: "SCHEDULE",
  GO_LIVE: "GO_LIVE",
  COMPLETE: "COMPLETE",
  ARCHIVE: "ARCHIVE",
};

const ASSIGNMENT_METHOD = {
  EVERYONE: "everyone",
  DEPARTMENT_WISE: "department_wise",
  BATCH_WISE: "batch_wise",
};

const ALLOWED_TRANSITIONS = {
  [TEST_STATUS.DRAFT]: [TEST_STATUS.SCHEDULED, TEST_STATUS.LIVE, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.SCHEDULED]: [TEST_STATUS.LIVE, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.LIVE]: [TEST_STATUS.COMPLETED, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.COMPLETED]: [TEST_STATUS.ARCHIVED],
  [TEST_STATUS.ARCHIVED]: [],
};

const mapQuestionType = (type) => {
  const map = {
    mcq: "MCQ",
    true_false: "TRUE_FALSE",
    fill_blank: "FILL_BLANK",
    paragraph: "PARAGRAPH",
  };
  return map[type];
};

const isPublishNow = (publishState) => publishState === "PUBLISH";
const isUpcoming = (publishState) => publishState === "UPCOMING";

const deriveLifecycleStatus = (test, now = new Date()) => {
  const status = test?.status;

  if (status === TEST_STATUS.ARCHIVED) {
    return TEST_STATUS.ARCHIVED;
  }

  if (status === TEST_STATUS.DRAFT) {
    return TEST_STATUS.DRAFT;
  }

  if (status === LEGACY_STATUS.UPCOMING) {
    return TEST_STATUS.SCHEDULED;
  }

  if (status === TEST_STATUS.SCHEDULED || status === TEST_STATUS.LIVE || status === TEST_STATUS.COMPLETED || status === LEGACY_STATUS.PUBLISHED) {
    const startsAt = test?.startsAt ? new Date(test.startsAt) : null;
    const endsAt = test?.endsAt ? new Date(test.endsAt) : null;

    if (startsAt && startsAt > now) {
      return TEST_STATUS.SCHEDULED;
    }

    if (endsAt && endsAt < now) {
      return TEST_STATUS.COMPLETED;
    }

    return TEST_STATUS.LIVE;
  }

  if (test?.isPublished) {
    const startsAt = test?.startsAt ? new Date(test.startsAt) : null;
    const endsAt = test?.endsAt ? new Date(test.endsAt) : null;

    if (startsAt && startsAt > now) {
      return TEST_STATUS.SCHEDULED;
    }

    if (endsAt && endsAt < now) {
      return TEST_STATUS.COMPLETED;
    }

    return TEST_STATUS.LIVE;
  }

  return TEST_STATUS.DRAFT;
};

const resolveStatus = (publishState, startsAt) => {
  if (isPublishNow(publishState)) {
    return startsAt > new Date() ? TEST_STATUS.SCHEDULED : TEST_STATUS.LIVE;
  }
  if (isUpcoming(publishState)) return TEST_STATUS.SCHEDULED;
  return TEST_STATUS.DRAFT;
};

const assertTransition = (currentStatus, nextStatus) => {
  if (currentStatus === nextStatus) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      409,
      `Invalid test status transition from ${currentStatus} to ${nextStatus}`,
      { currentStatus, nextStatus, allowedTransitions: allowed },
      "INVALID_TEST_STATUS_TRANSITION"
    );
  }
};

const hasQuestionMutation = (body) => Array.isArray(body?.questions);

const assertAdminCanOperateTest = (test) => {
  if (!test?.isGlobal) {
    return;
  }

  throw new ApiError(
    403,
    "This test is managed by super admin and is read-only for admins",
    { testId: test.id, scope: "SUPER_ADMIN" },
    "SUPER_ADMIN_TEST_READ_ONLY"
  );
};

const resolveTransitionTarget = (currentStatus, action) => {
  switch (action) {
    case TRANSITION_ACTION.SCHEDULE:
      return TEST_STATUS.SCHEDULED;
    case TRANSITION_ACTION.GO_LIVE:
      return TEST_STATUS.LIVE;
    case TRANSITION_ACTION.COMPLETE:
      return TEST_STATUS.COMPLETED;
    case TRANSITION_ACTION.ARCHIVE:
      return TEST_STATUS.ARCHIVED;
    default:
      throw new ApiError(422, `Unsupported transition action ${action}`, null, "INVALID_TRANSITION_ACTION");
  }
};

const transitionAuditAction = (action) => {
  switch (action) {
    case TRANSITION_ACTION.SCHEDULE:
      return "TEST_SCHEDULED";
    case TRANSITION_ACTION.GO_LIVE:
      return "TEST_LIVE";
    case TRANSITION_ACTION.COMPLETE:
      return "TEST_COMPLETED";
    case TRANSITION_ACTION.ARCHIVE:
      return "TEST_ARCHIVED";
    default:
      return "TEST_STATUS_CHANGED";
  }
};

const ensureBatchScope = async ({ db, batchIds, collegeId }) => {
  const matched = await db.batch.findMany({
    where: {
      id: { in: batchIds },
      collegeId,
    },
    select: { id: true },
  });

  if (matched.length !== batchIds.length) {
    throw new ApiError(422, "One or more batches are invalid for this college");
  }
};

const ensureBatchDepartmentScope = async ({ db, batchIds, collegeId, departmentId }) => {
  if (!Array.isArray(batchIds) || batchIds.length === 0) return;
  if (!departmentId) {
    throw new ApiError(422, "Department scope is required for batch-wise assignment");
  }

  const matched = await db.batch.findMany({
    where: {
      id: { in: batchIds },
      collegeId,
      departmentId,
    },
    select: { id: true },
  });

  if (matched.length !== batchIds.length) {
    throw new ApiError(422, "One or more batches are outside your department");
  }
};

const deriveAssignmentMethod = (test) => {
  if (Object.values(ASSIGNMENT_METHOD).includes(test?.assignmentMethod)) {
    return test.assignmentMethod;
  }

  if (test?.departmentId) {
    return ASSIGNMENT_METHOD.DEPARTMENT_WISE;
  }

  return ASSIGNMENT_METHOD.BATCH_WISE;
};

const resolveAssignmentBatchIds = async ({ db, assignmentMethod, batchIds, departmentId, collegeId }) => {
  if (assignmentMethod === ASSIGNMENT_METHOD.BATCH_WISE) {
    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      throw new ApiError(422, "Select at least one batch for batch-wise assignment");
    }
    return batchIds;
  }

  if (assignmentMethod === ASSIGNMENT_METHOD.DEPARTMENT_WISE && !departmentId) {
    throw new ApiError(422, "Select a department for department-wise assignment");
  }

  const where = {
    collegeId,
    ...(assignmentMethod === ASSIGNMENT_METHOD.DEPARTMENT_WISE ? { departmentId } : {}),
  };

  const batches = await db.batch.findMany({
    where,
    select: { id: true },
  });

  const resolved = batches.map((batch) => batch.id);

  if (!resolved.length) {
    if (assignmentMethod === ASSIGNMENT_METHOD.EVERYONE) {
      throw new ApiError(422, "No batches found in this college for everyone assignment");
    }

    // Department-wise tests are allowed even when a department currently has no batches.
    return [];
  }

  return resolved;
};

const assertNoOverlap = async ({ db, startsAt, endsAt, collegeId, skip }) => {
  if (skip) return;

  const overlap = await db.test.findFirst({
    where: {
      collegeId,
      isPublished: true,
      OR: [
        {
          startsAt: { lte: endsAt },
          endsAt: { gte: startsAt },
        },
      ],
    },
    select: { id: true },
  });

  if (overlap) {
    throw new ApiError(409, "Overlapping active test detected");
  }
};

const createTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const adminDepartmentId = req.admin?.departmentId;

  const {
    name,
    description,
    subject,
    durationMins,
    totalMarks,
    attemptsAllowed,
    evaluationRule,
    startsAt,
    endsAt,
    assignmentMethod,
    batchIds,
    testType,
    proctoringPreset,
    proctoringConfig,
    questions,
    restrictions,
    publishState,
    skipOverlapCheck,
  } = req.body;

  if (!adminDepartmentId) {
    throw new ApiError(403, "Admin is not linked to a department", null, "ADMIN_DEPARTMENT_REQUIRED");
  }

  const startsAtDate = new Date(startsAt);
  const endsAtDate = new Date(endsAt);
  const resolvedTestConfiguration = resolvePersistedTestConfiguration({
    testType,
    proctoringPreset,
    proctoringConfig,
    restrictions,
  });

  if (isPublishNow(publishState) && startsAtDate > new Date()) {
    throw new ApiError(422, "Cannot publish live before start date", null, "LIVE_BEFORE_START_NOT_ALLOWED");
  }

  const resolvedAssignmentMethod = assignmentMethod || ASSIGNMENT_METHOD.DEPARTMENT_WISE;
  if (resolvedAssignmentMethod === ASSIGNMENT_METHOD.EVERYONE) {
    throw new ApiError(422, "Admins can only assign tests within their department", null, "INVALID_ASSIGNMENT_SCOPE");
  }
  const resolvedDepartmentId = adminDepartmentId;
  const resolvedBatchIds = await resolveAssignmentBatchIds({
    db,
    assignmentMethod: resolvedAssignmentMethod,
    batchIds: Array.isArray(batchIds) ? batchIds : [],
    departmentId: resolvedDepartmentId,
    collegeId,
  });

  await ensureBatchScope({ db, batchIds: resolvedBatchIds, collegeId });
  if (resolvedAssignmentMethod === ASSIGNMENT_METHOD.BATCH_WISE) {
    await ensureBatchDepartmentScope({ db, batchIds: resolvedBatchIds, collegeId, departmentId: resolvedDepartmentId });
  }
  await assertNoOverlap({ db, startsAt: startsAtDate, endsAt: endsAtDate, collegeId, skip: skipOverlapCheck });

  const test = await db.$transaction(async (tx) => {
    const createdTest = await tx.test.create({
      data: {
        title: name,
        description,
        subject,
        durationMins,
        totalMarks,
        attemptsAllowed,
        evaluationRule,
        startsAt: startsAtDate,
        endsAt: endsAtDate,
        status: resolveStatus(publishState, startsAtDate),
        isPublished: isPublishNow(publishState) || isUpcoming(publishState),
        createdByAdminId: adminId,
        assignmentMethod: resolvedAssignmentMethod,
        departmentId: resolvedDepartmentId,
        collegeId,
        batchId: resolvedBatchIds[0] || null,
        ...resolvedTestConfiguration.persistenceFields,
      },
    });

    if (resolvedBatchIds.length > 0) {
      await tx.testBatch.createMany({
        data: resolvedBatchIds.map((batchId) => ({
          testId: createdTest.id,
          batchId,
          collegeId,
        })),
        skipDuplicates: true,
      });
    }

    await tx.question.createMany({
      data: questions.map((question, index) => ({
        testId: createdTest.id,
        collegeId,
        prompt: question.question,
        type: mapQuestionType(question.type),
        options: Array.isArray(question.options) ? question.options : [],
        correctOption: question.type === "mcq" ? String(question.correctAnswer) : null,
        correctBoolean: question.type === "true_false" ? Boolean(question.correctAnswer) : null,
        correctText: question.type === "fill_blank" || question.type === "paragraph" ? String(question.correctAnswer) : null,
        marks: question.marks,
        order: index + 1,
      })),
    });

    await createAuditLog({
      action: "TEST_CREATED",
      targetType: "TEST",
      targetId: createdTest.id,
      collegeId,
      adminId,
      testId: createdTest.id,
      afterState: {
        title: name,
        subject,
        publishState,
        assignmentMethod: resolvedAssignmentMethod,
        batchIds: resolvedBatchIds,
        testType: resolvedTestConfiguration.testType,
        proctoringPreset: resolvedTestConfiguration.proctoringPreset,
      },
    });

    return createdTest;
  });

  // Invalidate any cached test data so students see fresh content.
  await invalidateTestCache(test.id);

  res.status(201).json(attachResolvedTestConfiguration(test));
});

const getTests = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const status = req.query.status;
  const subject = req.query.subject;
  const search = req.query.search;
  const departmentId = req.query.departmentId;
  const batchId = req.query.batchId;
  const sortBy = req.query.sortBy || "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

  const allowedSortFields = new Set(["createdAt", "startsAt", "endsAt", "title", "status"]);
  const resolvedSortBy = allowedSortFields.has(sortBy) ? sortBy : "createdAt";

  const statusFilter = status
    ? {
        status: {
          in:
            status === TEST_STATUS.SCHEDULED
              ? [TEST_STATUS.SCHEDULED, LEGACY_STATUS.UPCOMING]
              : status === TEST_STATUS.LIVE
                ? [TEST_STATUS.LIVE, LEGACY_STATUS.PUBLISHED]
                : [status],
        },
      }
    : {};

  const baseWhere = {
    collegeId,
    ...(subject ? { subject } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(batchId ? { batchAssignments: { some: { batchId } } } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const where = {
    ...baseWhere,
    ...statusFilter,
  };

  const [total, data, statusCounts] = await Promise.all([
    db.test.count({ where }),
    db.test.findMany({
      where,
      include: {
        batchAssignments: {
          include: {
            batch: true,
          },
        },
        _count: {
          select: {
            questions: true,
            submissions: true,
          },
        },
      },
      orderBy: { [resolvedSortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    Promise.all([
      db.test.count({ where: baseWhere }),
      db.test.count({ where: { ...baseWhere, status: TEST_STATUS.DRAFT } }),
      db.test.count({ where: { ...baseWhere, status: { in: [TEST_STATUS.SCHEDULED, LEGACY_STATUS.UPCOMING] } } }),
      db.test.count({ where: { ...baseWhere, status: { in: [TEST_STATUS.LIVE, LEGACY_STATUS.PUBLISHED] } } }),
      db.test.count({ where: { ...baseWhere, status: TEST_STATUS.COMPLETED } }),
      db.test.count({ where: { ...baseWhere, status: TEST_STATUS.ARCHIVED } }),
    ]).then(([all, draft, scheduled, live, completed, archived]) => ({
      ALL: all,
      DRAFT: draft,
      SCHEDULED: scheduled,
      LIVE: live,
      COMPLETED: completed,
      ARCHIVED: archived,
    })),
  ]);

  const normalized = await Promise.all(
    data.map(async (item) => {
      const lifecycleStatus = deriveLifecycleStatus(item);

      if (lifecycleStatus !== item.status) {
        await db.test.update({
          where: { id: item.id },
          data: { status: lifecycleStatus },
        });
      }

      return {
        ...attachResolvedTestConfiguration(item),
        status: lifecycleStatus,
        canAdminOperate: !item.isGlobal,
        managedBy: item.isGlobal ? "SUPER_ADMIN" : "ADMIN",
      };
    })
  );

  res.status(200).json({
    data: normalized,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    statusCounts,
  });
});

const getTestById = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;

  const test = await db.test.findFirst({
    where: { id: testId, collegeId },
    include: {
      questions: {
        orderBy: { order: "asc" },
      },
      batchAssignments: {
        include: {
          batch: true,
        },
      },
      department: true,
      _count: {
        select: {
          questions: true,
          submissions: true,
        },
      },
    },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const lifecycleStatus = deriveLifecycleStatus(test);
  if (lifecycleStatus !== test.status) {
    await db.test.update({
      where: { id: test.id },
      data: { status: lifecycleStatus },
    });
  }

  res.status(200).json({
    ...attachResolvedTestConfiguration(test),
    status: lifecycleStatus,
    canAdminOperate: !test.isGlobal,
    managedBy: test.isGlobal ? "SUPER_ADMIN" : "ADMIN",
  });
});

const duplicateTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;

  const source = await db.test.findFirst({
    where: { id: testId, collegeId },
    include: {
      questions: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!source) {
    throw new ApiError(404, "Test not found");
  }

  assertAdminCanOperateTest(source);

  const now = new Date();
  const startsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + Math.max(5, source.durationMins || 60) * 60 * 1000);

  const duplicated = await db.$transaction(async (tx) => {
    const created = await tx.test.create({
      data: {
        title: `${source.title} (Copy)`,
        description: source.description,
        subject: source.subject,
        durationMins: source.durationMins,
        totalMarks: source.totalMarks,
        attemptsAllowed: source.attemptsAllowed,
        evaluationRule: source.evaluationRule,
        startsAt,
        endsAt,
        assignmentMethod: source.assignmentMethod || deriveAssignmentMethod(source),
        status: TEST_STATUS.DRAFT,
        isPublished: false,
        createdByAdminId: req.admin.id,
        departmentId: source.departmentId,
        collegeId,
        batchId: null,
        ...resolvePersistedTestConfiguration({ existingTest: source }).persistenceFields,
      },
    });

    if (Array.isArray(source.questions) && source.questions.length > 0) {
      await tx.question.createMany({
        data: source.questions.map((question) => ({
          testId: created.id,
          collegeId,
          prompt: question.prompt,
          type: question.type,
          options: Array.isArray(question.options) ? question.options : [],
          correctOption: question.correctOption,
          correctBoolean: question.correctBoolean,
          correctText: question.correctText,
          marks: question.marks,
          order: question.order,
        })),
      });
    }

    return created;
  });

  await createAuditLog({
    action: "TEST_DUPLICATED",
    targetType: "TEST",
    targetId: duplicated.id,
    collegeId,
    adminId: req.admin.id,
    testId: duplicated.id,
    beforeState: { sourceTestId: source.id, sourceTitle: source.title },
    afterState: { duplicatedTestId: duplicated.id, duplicatedTitle: duplicated.title },
  });

  res.status(201).json(attachResolvedTestConfiguration(duplicated));
});

const cloneTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;
  const adminDepartmentId = req.admin?.departmentId;
  const { assignmentMethod = "department_wise", departmentId = null, batchIds = [] } = req.body;

  if (!adminDepartmentId) {
    throw new ApiError(403, "Admin is not linked to a department", null, "ADMIN_DEPARTMENT_REQUIRED");
  }

  if (assignmentMethod === ASSIGNMENT_METHOD.EVERYONE) {
    throw new ApiError(422, "Admins can only assign tests within their department", null, "INVALID_ASSIGNMENT_SCOPE");
  }

  // Validate parameters based on assignment method
  if (assignmentMethod === "department_wise" && !departmentId) {
    throw new ApiError(422, "For department-wise assignment, provide departmentId", { assignmentMethod }, "MISSING_DEPARTMENT_ID");
  }
  if (assignmentMethod === "batch_wise" && (!Array.isArray(batchIds) || batchIds.length === 0)) {
    throw new ApiError(422, "For batch-wise assignment, provide batchIds array with at least one ID", { assignmentMethod }, "MISSING_BATCH_IDS");
  }

  if (departmentId && String(departmentId) !== String(adminDepartmentId)) {
    throw new ApiError(422, "Admins can only assign tests within their department", null, "INVALID_ASSIGNMENT_SCOPE");
  }

  if (assignmentMethod === "batch_wise") {
    await ensureBatchDepartmentScope({ db, batchIds, collegeId, departmentId: adminDepartmentId });
  }

  const source = await db.test.findFirst({ where: { id: testId, collegeId } });
  if (!source) throw new ApiError(404, "Test not found in this college");

  assertAdminCanOperateTest(source);

  // Ensure source belongs to this college and is not global
  if (source.isGlobal) {
    throw new ApiError(403, "Cannot clone super-admin managed test as admin");
  }

  console.log("[CLONE_TEST_ADMIN] Cloning test within college", {
    sourceTestId: testId,
    collegeId,
    assignmentMethod,
    departmentId,
    batchIdCount: batchIds.length,
  });

  const cloned = await cloneTestWithinCollege({
    sourceTestId: testId,
    collegeId,
    assignmentMethod,
    departmentId: adminDepartmentId,
    batchIds: Array.isArray(batchIds) ? batchIds : [],
    adminId: req.admin.id,
  });

  console.log("[CLONE_TEST_ADMIN] Clone successful", { clonedTestId: cloned.id, title: cloned.title });

  await createAuditLog({
    action: "TEST_CLONED",
    targetType: "TEST",
    targetId: cloned.id,
    collegeId,
    adminId: req.admin.id,
    beforeState: { sourceTestId: testId },
    afterState: {
      clonedTestId: cloned.id,
      sourceTestId: cloned.sourceTestId,
      assignmentMethod,
      departmentId,
      batchIds,
      status: cloned.status,
      isPublished: cloned.isPublished,
    },
  });

  res.status(201).json({
    id: cloned.id,
    title: cloned.title,
    status: cloned.status,
    isPublished: cloned.isPublished,
    sourceTestId: cloned.sourceTestId,
    collegeId: cloned.collegeId,
    assignmentMethod: cloned.assignmentMethod,
    message: "Test cloned successfully within college and kept in DRAFT status",
    data: attachResolvedTestConfiguration(cloned),
  });
});

const updateTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;
  const adminDepartmentId = req.admin?.departmentId;

  const existing = await db.test.findFirst({
    where: { id: testId, collegeId },
    include: {
      batchAssignments: {
        select: { batchId: true },
      },
    },
  });
  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  if (!adminDepartmentId) {
    throw new ApiError(403, "Admin is not linked to a department", null, "ADMIN_DEPARTMENT_REQUIRED");
  }

  assertAdminCanOperateTest(existing);

  const currentStatus = deriveLifecycleStatus(existing);
  const providedKeys = Object.entries(req.body || {})
    .filter(([, value]) => typeof value !== "undefined")
    .map(([key]) => key);

  if (hasQuestionMutation(req.body) && currentStatus !== TEST_STATUS.DRAFT) {
    throw new ApiError(
      409,
      "Question mutations are allowed only while test is in draft state",
      { currentStatus },
      "QUESTION_EDIT_LOCKED"
    );
  }

  if (currentStatus === TEST_STATUS.COMPLETED || currentStatus === TEST_STATUS.ARCHIVED) {
    throw new ApiError(409, `Test is ${currentStatus.toLowerCase()} and immutable`, null, "TEST_IMMUTABLE");
  }

  if (currentStatus === TEST_STATUS.LIVE) {
    const allowedLiveKeys = ["endsAt"];
    const invalidLiveKeys = providedKeys.filter((key) => !allowedLiveKeys.includes(key));

    if (invalidLiveKeys.length > 0) {
      throw new ApiError(
        409,
        "Live tests allow only end-time extension",
        { invalidFields: invalidLiveKeys },
        "LIVE_TEST_RESTRICTED_UPDATE"
      );
    }
  }

  if (req.body.startsAt) {
    const startsAt = new Date(req.body.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ApiError(422, "Invalid startsAt date", null, "INVALID_START_DATE");
    }

    if (currentStatus !== TEST_STATUS.DRAFT && startsAt < new Date()) {
      throw new ApiError(422, "Cannot move start date to the past", null, "INVALID_START_DATE");
    }
  }

  if (req.body.endsAt) {
    const endsAt = new Date(req.body.endsAt);
    if (Number.isNaN(endsAt.getTime())) {
      throw new ApiError(422, "Invalid endsAt date", null, "INVALID_END_DATE");
    }

    const compareStart = req.body.startsAt ? new Date(req.body.startsAt) : new Date(existing.startsAt);
    if (endsAt <= compareStart) {
      throw new ApiError(422, "End date/time must be after start date/time", null, "INVALID_END_DATE");
    }

    if (currentStatus === TEST_STATUS.LIVE && endsAt <= new Date(existing.endsAt)) {
      throw new ApiError(422, "Live test end time can only be extended forward", null, "LIVE_END_TIME_EXTENSION_ONLY");
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const nextStartsAt = req.body.startsAt ? new Date(req.body.startsAt) : existing.startsAt;
    const nextEndsAt = req.body.endsAt ? new Date(req.body.endsAt) : existing.endsAt;

    const shouldUpdateAssignment =
      typeof req.body.assignmentMethod !== "undefined"
      || typeof req.body.departmentId !== "undefined"
      || Array.isArray(req.body.batchIds);
    const resolvedTestConfiguration = resolvePersistedTestConfiguration({
      existingTest: existing,
      testType: req.body?.testType,
      proctoringPreset: req.body?.proctoringPreset,
      proctoringConfig: req.body?.proctoringConfig,
      restrictions: req.body?.restrictions,
    });

    let resolvedBatchIds = existing.batchAssignments.map((item) => item.batchId);
    let resolvedDepartmentId = existing.departmentId;
    let resolvedAssignmentMethod = deriveAssignmentMethod(existing);
    if (shouldUpdateAssignment) {
      resolvedAssignmentMethod = req.body.assignmentMethod || resolvedAssignmentMethod;
      if (resolvedAssignmentMethod === ASSIGNMENT_METHOD.EVERYONE) {
        throw new ApiError(422, "Admins can only assign tests within their department", null, "INVALID_ASSIGNMENT_SCOPE");
      }
      const requestedBatchIds = Array.isArray(req.body.batchIds)
        ? req.body.batchIds
        : resolvedBatchIds;
      resolvedDepartmentId = adminDepartmentId;

      resolvedBatchIds = await resolveAssignmentBatchIds({
        db,
        assignmentMethod: resolvedAssignmentMethod,
        batchIds: requestedBatchIds,
        departmentId: resolvedDepartmentId,
        collegeId,
      });
      await ensureBatchScope({ db, batchIds: resolvedBatchIds, collegeId });
      if (resolvedAssignmentMethod === ASSIGNMENT_METHOD.BATCH_WISE) {
        await ensureBatchDepartmentScope({ db, batchIds: resolvedBatchIds, collegeId, departmentId: resolvedDepartmentId });
      }
    }

    const updatedTest = await tx.test.update({
      where: { id: testId },
      data: {
        title: req.body.name ?? existing.title,
        description: req.body.description ?? existing.description,
        subject: req.body.subject ?? existing.subject,
        durationMins: req.body.durationMins ?? existing.durationMins,
        totalMarks: req.body.totalMarks ?? existing.totalMarks,
        attemptsAllowed: req.body.attemptsAllowed ?? existing.attemptsAllowed,
        evaluationRule: req.body.evaluationRule ?? existing.evaluationRule,
        assignmentMethod: shouldUpdateAssignment
          ? resolvedAssignmentMethod
          : (existing.assignmentMethod || deriveAssignmentMethod(existing)),
        departmentId: shouldUpdateAssignment ? resolvedDepartmentId : existing.departmentId,
        batchId: shouldUpdateAssignment ? (resolvedBatchIds[0] || null) : existing.batchId,
        ...resolvedTestConfiguration.persistenceFields,
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        status: deriveLifecycleStatus(
          {
            ...existing,
            startsAt: nextStartsAt,
            endsAt: nextEndsAt,
          },
          new Date()
        ),
      },
    });

    if (shouldUpdateAssignment) {
      await tx.testBatch.deleteMany({ where: { testId, collegeId } });
      await tx.testBatch.createMany({
        data: resolvedBatchIds.map((batchId) => ({
          testId,
          batchId,
          collegeId,
        })),
        skipDuplicates: true,
      });
    }

    if (hasQuestionMutation(req.body)) {
      await tx.question.deleteMany({ where: { testId, collegeId } });
      await tx.question.createMany({
        data: req.body.questions.map((question, index) => ({
          testId,
          collegeId,
          prompt: question.question,
          type: mapQuestionType(question.type),
          options: Array.isArray(question.options) ? question.options : [],
          correctOption: question.type === "mcq" ? String(question.correctAnswer) : null,
          correctBoolean: question.type === "true_false" ? Boolean(question.correctAnswer) : null,
          correctText: question.type === "fill_blank" || question.type === "paragraph" ? String(question.correctAnswer) : null,
          marks: question.marks,
          order: index + 1,
        })),
      });
    }

    return updatedTest;
  });

  await createAuditLog({
    action: "TEST_UPDATED",
    targetType: "TEST",
    targetId: testId,
    collegeId,
    adminId: req.admin.id,
    testId,
    beforeState: {
      title: existing.title,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
    },
    afterState: {
      title: updated.title,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
      departmentId: updated.departmentId,
      batchId: updated.batchId,
      testType: updated.testType,
      proctoringPreset: updated.proctoringPreset,
    },
  });

  // Invalidate cached test data after update.
  await invalidateTestCache(testId);

  res.status(200).json(attachResolvedTestConfiguration(updated));
});

const deleteTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;

  const existing = await db.test.findFirst({ where: { id: testId, collegeId } });
  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  assertAdminCanOperateTest(existing);

  const currentStatus = deriveLifecycleStatus(existing);
  const submissionCount = await db.submission.count({ where: { testId, collegeId } });

  if (currentStatus !== TEST_STATUS.DRAFT || submissionCount > 0) {
    throw new ApiError(
      409,
      "Only draft tests with zero submissions can be deleted. Archive this test instead.",
      { currentStatus, submissionCount },
      "TEST_DELETE_BLOCKED"
    );
  }

  await db.test.delete({ where: { id: testId } });

  await createAuditLog({
    action: "TEST_DELETED",
    targetType: "TEST",
    targetId: testId,
    collegeId,
    adminId: req.admin.id,
    testId,
    beforeState: {
      title: existing.title,
    },
  });

  // Invalidate cached test data after deletion.
  await invalidateTestCache(testId);

  res.status(200).json({ message: "Test deleted" });
});

const publishTest = asyncHandler(async (req, res) => {
  req.body = { ...(req.body || {}), action: TRANSITION_ACTION.GO_LIVE };
  return transitionTestStatus(req, res);
});

const archiveTest = asyncHandler(async (req, res) => {
  req.body = { ...(req.body || {}), action: TRANSITION_ACTION.ARCHIVE };
  return transitionTestStatus(req, res);
});

const transitionTestStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;
  const { action } = req.body;

  const existing = await db.test.findFirst({
    where: { id: testId, collegeId },
    include: {
      _count: {
        select: {
          questions: true,
        },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  assertAdminCanOperateTest(existing);

  const currentStatus = deriveLifecycleStatus(existing);

  if (action === TRANSITION_ACTION.SCHEDULE && existing.startsAt <= new Date()) {
    throw new ApiError(409, "Scheduled transition requires a future start date", null, "SCHEDULE_REQUIRES_FUTURE_START");
  }

  if ((action === TRANSITION_ACTION.SCHEDULE || action === TRANSITION_ACTION.GO_LIVE) && existing._count.questions === 0) {
    throw new ApiError(422, "Cannot transition test without questions", null, "TEST_NO_QUESTIONS");
  }

  const targetStatus = resolveTransitionTarget(currentStatus, action);
  assertTransition(currentStatus, targetStatus);

  const updated = await db.test.update({
    where: { id: testId },
    data: {
      status: targetStatus,
      isPublished: action === TRANSITION_ACTION.COMPLETE || action === TRANSITION_ACTION.ARCHIVE ? false : true,
      startsAt: action === TRANSITION_ACTION.GO_LIVE && existing.startsAt > new Date() ? new Date() : existing.startsAt,
      endsAt: action === TRANSITION_ACTION.COMPLETE && existing.endsAt > new Date() ? new Date() : existing.endsAt,
    },
  });

  await createAuditLog({
    action: transitionAuditAction(action),
    targetType: "TEST",
    targetId: testId,
    collegeId,
    adminId: req.admin.id,
    testId,
    afterState: {
      status: targetStatus,
      action,
    },
  });

  emitToCollege(collegeId, "test_status_change", {
    testId,
    status: updated.status,
    action,
  });
  emitToTestRoom(testId, "test_status_change", {
    testId,
    status: updated.status,
    action,
  });

  res.status(200).json(updated);
});

const getLiveMonitoring = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const collegeId = req.collegeId;

  const test = await db.test.findFirst({
    where: { id: testId, collegeId },
    select: { id: true, title: true, durationMins: true, status: true, startsAt: true, endsAt: true },
  });

  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  assertAdminCanOperateTest(test);

  const [inProgress, questionCount, sessions, rateLimits] = await Promise.all([
    db.submission.findMany({
      where: { testId, collegeId, status: "IN_PROGRESS" },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            studentId: true,
            department: { select: { name: true } },
            batch: { select: { name: true } },
          },
        },
        violations: {
          select: { id: true, type: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: {
          select: { answers: true, violations: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.question.count({ where: { testId, collegeId } }),
    db.testSession.findMany({ where: { testId }, select: { userId: true, submissionId: true, expiresAt: true } }),
    getExamRateLimitMetricsSnapshot({ limit: 5, collegeId }),
  ]);

  const nowMs = Date.now();
  const sessionMap = new Map(sessions.map((item) => [item.submissionId, item]));
  const studentTable = inProgress.map((submission) => {
    const answered = Number(submission?._count?.answers || 0);
    const progress = questionCount > 0 ? Math.min(100, Math.round((answered / questionCount) * 100)) : 0;
    const session = sessionMap.get(submission.id);
    const baselineExpiry = submission.startedAt
      ? new Date(new Date(submission.startedAt).getTime() + Number(test.durationMins || 0) * 60 * 1000)
      : new Date(nowMs);
    const expiresAt = session?.expiresAt || baselineExpiry;
    const timeLeftSec = Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
    const lastHeartbeat = submission.lastAutoSavedAt ? new Date(submission.lastAutoSavedAt).getTime() : new Date(submission.updatedAt).getTime();
    const idleSeconds = Math.max(0, Math.floor((nowMs - lastHeartbeat) / 1000));
    const connectionStatus = idleSeconds <= 45 ? "ONLINE" : idleSeconds <= 120 ? "UNSTABLE" : "OFFLINE";

    return {
      submissionId: submission.id,
      studentId: submission.userId,
      name: submission.user?.fullName || "Student",
      department: submission.user?.department?.name || "-",
      batch: submission.user?.batch?.name || "-",
      progress,
      timeLeftSec,
      violations: Number(submission?._count?.violations || 0),
      connectionStatus,
      status: submission.status,
      startedAt: submission.startedAt,
    };
  });

  const violationFeed = inProgress.flatMap((submission) =>
    (submission.violations || []).map((violation) => ({
      id: violation.id,
      submissionId: submission.id,
      studentId: submission.userId,
      studentName: submission.user?.fullName || "Student",
      type: violation.type,
      at: violation.createdAt,
    }))
  ).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 100);

  res.status(200).json({
    test: {
      ...test,
      activeStudents: studentTable.length,
      questionCount,
    },
    rateLimits,
    studentTable,
    violationFeed,
    generatedAt: new Date().toISOString(),
  });
});

const forceSubmitAttempt = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { submissionId, reason } = req.body;
  const collegeId = req.collegeId;

  const submission = await db.submission.findFirst({
    where: { id: submissionId, testId, collegeId },
    include: {
      user: { select: { fullName: true } },
      test: { select: { id: true, isGlobal: true } },
    },
  });

  if (!submission) {
    throw new ApiError(404, "Submission not found");
  }

  assertAdminCanOperateTest(submission.test);

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Submission is already completed", null, "SUBMISSION_ALREADY_COMPLETED");
  }

  const completed = await completeSubmission({ submissionId, autoSubmitted: true });

  await createAuditLog({
    action: "ADMIN_FORCE_SUBMIT",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId,
    adminId: req.admin.id,
    testId,
    afterState: {
      reason,
      status: completed.status,
      studentId: submission.userId,
    },
  });

  const payload = {
    testId,
    submissionId,
    studentId: submission.userId,
    studentName: submission.user?.fullName || "Student",
    reason,
    action: "FORCE_SUBMIT",
    status: completed.status,
  };

  emitToTestRoom(testId, "test_status_change", payload);
  emitToCollege(collegeId, "test_status_change", payload);

  res.status(200).json({ message: "Submission force-submitted", submission: completed });
});

const extendAttemptTime = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { submissionId, minutes } = req.body;
  const collegeId = req.collegeId;

  const submission = await db.submission.findFirst({
    where: { id: submissionId, testId, collegeId },
    include: {
      user: { select: { fullName: true } },
      test: { select: { id: true, isGlobal: true } },
    },
  });

  if (!submission) {
    throw new ApiError(404, "Submission not found");
  }

  assertAdminCanOperateTest(submission.test);

  if (submission.status !== "IN_PROGRESS") {
    throw new ApiError(409, "Only in-progress attempts can be extended", null, "SUBMISSION_NOT_ACTIVE");
  }

  const session = await db.testSession.findFirst({ where: { testId, submissionId, userId: submission.userId } });
  if (!session) {
    throw new ApiError(404, "Active test session not found", null, "SESSION_NOT_FOUND");
  }

  const mins = Math.max(1, Number(minutes || 0));
  const nextExpiry = new Date(new Date(session.expiresAt).getTime() + mins * 60 * 1000);

  const updated = await db.testSession.update({
    where: { userId_testId: { userId: submission.userId, testId } },
    data: { expiresAt: nextExpiry },
  });

  await createAuditLog({
    action: "ADMIN_EXTEND_TIME",
    targetType: "SUBMISSION",
    targetId: submissionId,
    collegeId,
    adminId: req.admin.id,
    testId,
    afterState: {
      minutesAdded: mins,
      expiresAt: updated.expiresAt,
      studentId: submission.userId,
    },
  });

  const payload = {
    testId,
    submissionId,
    studentId: submission.userId,
    studentName: submission.user?.fullName || "Student",
    action: "TIME_EXTENDED",
    minutesAdded: mins,
    expiresAt: updated.expiresAt,
  };

  emitToTestRoom(testId, "student_status_update", payload);
  emitToCollege(collegeId, "student_status_update", payload);

  res.status(200).json({ message: "Time extended", session: updated });
});

module.exports = {
  createTest,
  getTests,
  getTestById,
  duplicateTest,
  cloneTest,
  updateTest,
  deleteTest,
  publishTest,
  archiveTest,
  transitionTestStatus,
  getLiveMonitoring,
  forceSubmitAttempt,
  extendAttemptTime,
};
