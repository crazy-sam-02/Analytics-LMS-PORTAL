const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const {
  attachResolvedTestConfiguration,
  resolvePersistedTestConfiguration,
} = require("../../services/test-config.service");
const { cloneTestToCollege: cloneServiceToCollege } = require("../../services/clone.service");

const TEST_STATUS = {
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
};

const LEGACY_STATUS = {
  UPCOMING: "UPCOMING",
  PUBLISHED: "PUBLISHED",
};

const TRANSITION_ACTION = {
  SCHEDULE: "SCHEDULE",
  GO_LIVE: "GO_LIVE",
  COMPLETE: "COMPLETE",
  ARCHIVE: "ARCHIVE",
};

const ALLOWED_TRANSITIONS = {
  [TEST_STATUS.DRAFT]: [TEST_STATUS.SCHEDULED, TEST_STATUS.LIVE, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.SCHEDULED]: [TEST_STATUS.LIVE, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.LIVE]: [TEST_STATUS.COMPLETED, TEST_STATUS.ARCHIVED],
  [TEST_STATUS.COMPLETED]: [TEST_STATUS.ARCHIVED],
  [TEST_STATUS.ARCHIVED]: [],
};

const deriveLifecycleStatus = (test, now = new Date()) => {
  const status = String(test?.status || "").toUpperCase();

  if (status === TEST_STATUS.ARCHIVED) {
    return TEST_STATUS.ARCHIVED;
  }

  if (status === TEST_STATUS.DRAFT) {
    return TEST_STATUS.DRAFT;
  }

  if (status === LEGACY_STATUS.UPCOMING) {
    return TEST_STATUS.SCHEDULED;
  }

  if (
    status === TEST_STATUS.SCHEDULED
    || status === TEST_STATUS.LIVE
    || status === TEST_STATUS.COMPLETED
    || status === LEGACY_STATUS.PUBLISHED
  ) {
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

const resolveTransitionTarget = (action) => {
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
      return "SUPER_ADMIN_TEST_SCHEDULED";
    case TRANSITION_ACTION.GO_LIVE:
      return "SUPER_ADMIN_TEST_LIVE";
    case TRANSITION_ACTION.COMPLETE:
      return "SUPER_ADMIN_TEST_COMPLETED";
    case TRANSITION_ACTION.ARCHIVE:
      return "SUPER_ADMIN_TEST_ARCHIVED";
    default:
      return "SUPER_ADMIN_TEST_STATUS_CHANGED";
  }
};

const getTestsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const collegeId = req.query.collegeId;
  const search = (req.query.search || "").trim();
  const status = (req.query.status || "").trim().toUpperCase();

  const statusFilter = !status || status === "ALL"
    ? {}
    : status === TEST_STATUS.SCHEDULED
      ? { status: { in: [TEST_STATUS.SCHEDULED, LEGACY_STATUS.UPCOMING] } }
      : status === TEST_STATUS.LIVE
        ? { status: { in: [TEST_STATUS.LIVE, LEGACY_STATUS.PUBLISHED] } }
        : { status };

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...statusFilter,
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { subject: { contains: search, mode: "insensitive" } },
            {
              college: {
                name: { contains: search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.test.findMany({
      where,
      include: {
        college: true,
        department: true,
        batch: true,
        _count: {
          select: {
            questions: true,
            submissions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.test.count({ where }),
  ]);

  res.status(200).json({
    data: items.map((item) => attachResolvedTestConfiguration(item)),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const getGlobalTestById = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;

  const test = await db.test.findUnique({
    where: { id: testId },
    include: {
      college: true,
      department: true,
      questions: {
        orderBy: { order: "asc" },
      },
      batchAssignments: {
        select: {
          batchId: true,
          batch: {
            select: {
              id: true,
              name: true,
              year: true,
              departmentId: true,
              collegeId: true,
            },
          },
        },
      },
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
  });
});

const createGlobalTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const payload = req.body;
  let collegeIds = Array.isArray(payload.collegeIds) ? payload.collegeIds : [];
  const assignmentMethod = payload.assignmentMethod || "department_wise";
  const requestedBatchIds = Array.isArray(payload.batchIds) ? payload.batchIds : [];
  const requestedDepartmentIds = Array.isArray(payload.departmentIds) ? payload.departmentIds : [];
  const resolvedTestConfiguration = resolvePersistedTestConfiguration({
    testType: payload.testType,
    proctoringPreset: payload.proctoringPreset,
    proctoringConfig: payload.proctoringConfig,
    restrictions: payload.restrictions,
  });

  if (payload.allColleges) {
    const colleges = await db.college.findMany({ where: { isActive: true }, select: { id: true } });
    collegeIds = colleges.map((item) => item.id);
  }

  if (!collegeIds.length) {
    throw new ApiError(400, "At least one college must be targeted");
  }

  const normalizedCollegeIds = [...new Set(collegeIds.filter(Boolean))];

  let scopedDepartmentIds = [];
  let scopedBatchIds = [];

  if (assignmentMethod === "department_wise") {
    const normalizedDepartmentIds = [...new Set(requestedDepartmentIds.filter(Boolean))];

    if (!normalizedDepartmentIds.length) {
      throw new ApiError(422, "Select at least one department for department-wise assignment");
    }

    const scopedDepartments = await db.department.findMany({
      where: {
        id: { in: normalizedDepartmentIds },
        collegeId: { in: normalizedCollegeIds },
      },
      select: { id: true, collegeId: true },
    });

    scopedDepartmentIds = scopedDepartments.map((item) => item.id);

    const missingDepartmentIds = normalizedDepartmentIds.filter((id) => !scopedDepartmentIds.includes(id));
    if (missingDepartmentIds.length > 0) {
      throw new ApiError(
        422,
        "Some selected departments are invalid for the selected colleges",
        { missingDepartmentIds },
        "INVALID_DEPARTMENT_SCOPE"
      );
    }
  }

  if (assignmentMethod === "batch_wise") {
    const normalizedBatchIds = [...new Set(requestedBatchIds.filter(Boolean))];

    if (!normalizedBatchIds.length) {
      throw new ApiError(422, "Select at least one batch for batch-wise assignment");
    }

    const scopedBatches = await db.batch.findMany({
      where: {
        id: { in: normalizedBatchIds },
        collegeId: { in: normalizedCollegeIds },
      },
      select: { id: true },
    });

    scopedBatchIds = scopedBatches.map((item) => item.id);

    const missingBatchIds = normalizedBatchIds.filter((id) => !scopedBatchIds.includes(id));
    if (missingBatchIds.length > 0) {
      throw new ApiError(
        422,
        "Some selected batches are invalid for the selected colleges",
        { missingBatchIds },
        "INVALID_BATCH_SCOPE"
      );
    }
  }

  const admins = await db.admin.findMany({
    where: {
      collegeId: { in: normalizedCollegeIds },
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      collegeId: true,
    },
  });

  const adminByCollege = new Map();
  admins.forEach((admin) => {
    if (!adminByCollege.has(admin.collegeId)) {
      adminByCollege.set(admin.collegeId, admin);
    }
  });

  const candidateBatches = await db.batch.findMany({
    where: {
      collegeId: { in: normalizedCollegeIds },
      ...(assignmentMethod === "batch_wise"
        ? { id: { in: scopedBatchIds } }
        : scopedDepartmentIds.length
          ? { departmentId: { in: scopedDepartmentIds } }
          : {}),
    },
    select: {
      id: true,
      collegeId: true,
      departmentId: true,
    },
  });

  const batchesByCollege = new Map();
  candidateBatches.forEach((batch) => {
    const existing = batchesByCollege.get(batch.collegeId) || [];
    existing.push(batch);
    batchesByCollege.set(batch.collegeId, existing);
  });

  const departmentsByCollege = new Map();
  if (assignmentMethod === "department_wise") {
    const scopedDepartments = await db.department.findMany({
      where: {
        id: { in: scopedDepartmentIds },
        collegeId: { in: normalizedCollegeIds },
      },
      select: {
        id: true,
        collegeId: true,
      },
    });

    scopedDepartments.forEach((department) => {
      const existing = departmentsByCollege.get(department.collegeId) || [];
      existing.push(department);
      departmentsByCollege.set(department.collegeId, existing);
    });
  }

  const created = [];

  for (const collegeId of normalizedCollegeIds) {
    const eligibleBatches = batchesByCollege.get(collegeId) || [];
    const resolvedBatchIds = eligibleBatches.map((item) => item.id);
    const scopedDepartmentsForCollege = departmentsByCollege.get(collegeId) || [];

    if (assignmentMethod === "batch_wise" && !resolvedBatchIds.length) {
      continue;
    }

    if (assignmentMethod === "department_wise" && !scopedDepartmentsForCollege.length) {
      continue;
    }

    const admin = adminByCollege.get(collegeId);

    if (!admin) {
      continue;
    }

    const assignedDepartmentIds = assignmentMethod === "department_wise"
      ? scopedDepartmentsForCollege.map((department) => department.id)
      : [];

    const resolvedDepartmentId =
      assignmentMethod === "department_wise" && assignedDepartmentIds.length === 1
        ? assignedDepartmentIds[0]
        : null;

    const test = await db.test.create({
      data: {
        title: payload.title,
        subject: payload.subject,
        description: payload.description || null,
        durationMins: payload.durationMins,
        totalMarks: payload.totalMarks,
        attemptsAllowed: payload.attemptsAllowed,
        evaluationRule: payload.evaluationRule,
        startsAt: new Date(payload.startsAt),
        endsAt: new Date(payload.endsAt),
        isPublished: true,
        status: TEST_STATUS.SCHEDULED,
        isGlobal: true,
        assignmentMethod,
        assignedTo: assignedDepartmentIds,
        collegeId,
        batchId: resolvedBatchIds[0] || null,
        createdByAdminId: admin.id,
        departmentId: resolvedDepartmentId,
        ...resolvedTestConfiguration.persistenceFields,
      },
    });

    if (resolvedBatchIds.length > 0) {
      await db.testBatch.createMany({
        data: resolvedBatchIds.map((batchId) => ({
          testId: test.id,
          batchId,
          collegeId,
        })),
        skipDuplicates: true,
      });
    }

    const questionRows = payload.questions.map((question, index) => ({
      testId: test.id,
      collegeId,
      prompt: question.prompt,
      type: question.type,
      options: question.options || [],
      correctOption: question.correctOption || null,
      correctBoolean: question.correctBoolean ?? null,
      correctText: question.correctText || null,
      marks: question.marks || 1,
      order: index + 1,
    }));

    if (questionRows.length > 0) {
      await db.question.createMany({ data: questionRows });
    }

    created.push(test);
  }

  if (!created.length) {
    throw new ApiError(422, "No eligible college/batch scope found for assignment selection");
  }

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_GLOBAL_TEST",
    targetType: "TEST",
    targetId: created[0]?.id || "multi",
    superAdminId: req.superAdmin.id,
    afterState: {
      title: payload.title,
      colleges: normalizedCollegeIds,
      createdCount: created.length,
      testType: resolvedTestConfiguration.testType,
      proctoringPreset: resolvedTestConfiguration.proctoringPreset,
    },
  });

  res.status(201).json({
    message: "Global test created",
    data: created.map((item) => attachResolvedTestConfiguration(item)),
  });
});

const cloneTestToCollege = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { destinationCollegeId, assignmentMethod = "batch_wise", departmentIds = [], batchIds = [] } = req.body;

  // Validate destination college is provided
  if (!destinationCollegeId) {
    throw new ApiError(422, "destinationCollegeId is required", null, "MISSING_DESTINATION_COLLEGE");
  }

  // Validate assignment parameters based on method
  if (assignmentMethod === "department_wise" && (!Array.isArray(departmentIds) || departmentIds.length === 0)) {
    throw new ApiError(422, "For department-wise assignment, provide departmentIds array with at least one ID", { assignmentMethod }, "MISSING_DEPARTMENT_IDS");
  }
  if (assignmentMethod === "batch_wise" && (!Array.isArray(batchIds) || batchIds.length === 0)) {
    throw new ApiError(422, "For batch-wise assignment, provide batchIds array with at least one ID", { assignmentMethod }, "MISSING_BATCH_IDS");
  }

  console.log("[CLONE_TEST] Cloning test", {
    sourceTestId: testId,
    destinationCollegeId,
    assignmentMethod,
    departmentIdCount: departmentIds.length,
    batchIdCount: batchIds.length,
  });

  const cloned = await cloneServiceToCollege({
    sourceTestId: testId,
    destinationCollegeId,
    assignmentMethod,
    departmentIds: Array.isArray(departmentIds) ? departmentIds : [],
    batchIds: Array.isArray(batchIds) ? batchIds : [],
    superAdminId: req.superAdmin.id,
  });

  console.log("[CLONE_TEST] Clone successful", { clonedTestId: cloned.id, title: cloned.title });

  await createAuditLog({
    action: "SUPER_ADMIN_CLONE_TEST",
    targetType: "TEST",
    targetId: cloned.id,
    collegeId: destinationCollegeId,
    superAdminId: req.superAdmin.id,
    beforeState: { sourceTestId: testId },
    afterState: {
      clonedTestId: cloned.id,
      sourceTestId: cloned.sourceTestId,
      destinationCollegeId,
      assignmentMethod,
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
    message: "Test cloned successfully to destination college and kept in DRAFT status",
    data: attachResolvedTestConfiguration(cloned),
  });
});

const updateGlobalTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const payload = req.body;

  const existing = await db.test.findUnique({
    where: { id: testId },
    include: {
      questions: true,
      batchAssignments: true,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const currentStatus = deriveLifecycleStatus(existing);
  if (currentStatus === TEST_STATUS.ARCHIVED) {
    throw new ApiError(409, "Archived tests cannot be edited", { currentStatus }, "ARCHIVED_TEST_EDIT_BLOCKED");
  }

  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(payload.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ApiError(422, "Invalid startsAt/endsAt values");
  }
  const resolvedTestConfiguration = resolvePersistedTestConfiguration({
    existingTest: existing,
    testType: payload.testType,
    proctoringPreset: payload.proctoringPreset,
    proctoringConfig: payload.proctoringConfig,
    restrictions: payload.restrictions,
  });

  const rootSourceId = existing.sourceTestId || existing.id;
  let targetCollegeIds = Array.isArray(payload.collegeIds)
    ? payload.collegeIds.filter(Boolean)
    : [];

  if (payload.allColleges) {
    const colleges = await db.college.findMany({ where: { isActive: true }, select: { id: true } });
    targetCollegeIds = colleges.map((item) => item.id);
  }

  if (!targetCollegeIds.length) {
    targetCollegeIds = [existing.collegeId];
  }

  if (!targetCollegeIds.includes(existing.collegeId)) {
    targetCollegeIds.push(existing.collegeId);
  }

  targetCollegeIds = [...new Set(targetCollegeIds.filter(Boolean))];

  const assignmentMethod = payload.assignmentMethod || "department_wise";
  const selectedDepartmentIds = assignmentMethod === "department_wise"
    ? [...new Set((Array.isArray(payload.departmentIds) ? payload.departmentIds : []).filter(Boolean))]
    : [];
  const selectedBatchIds = assignmentMethod === "batch_wise"
    ? [...new Set((Array.isArray(payload.batchIds) ? payload.batchIds : []).filter(Boolean))]
    : [];

  if (assignmentMethod === "department_wise" && !selectedDepartmentIds.length) {
    throw new ApiError(422, "Select at least one department for department-wise assignment");
  }

  if (assignmentMethod === "batch_wise" && !selectedBatchIds.length) {
    throw new ApiError(422, "Select at least one batch for batch-wise assignment");
  }

  const [familyTests, admins] = await Promise.all([
    db.test.findMany({
      where: {
        collegeId: { in: targetCollegeIds },
        OR: [{ id: rootSourceId }, { sourceTestId: rootSourceId }],
      },
      select: { id: true, collegeId: true },
    }),
    db.admin.findMany({
      where: {
        collegeId: { in: targetCollegeIds },
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, collegeId: true },
    }),
  ]);

  const familyTestByCollege = new Map();
  familyTests.forEach((item) => {
    if (!familyTestByCollege.has(item.collegeId)) {
      familyTestByCollege.set(item.collegeId, item);
    }
  });

  const adminByCollege = new Map();
  admins.forEach((item) => {
    if (!adminByCollege.has(item.collegeId)) {
      adminByCollege.set(item.collegeId, item.id);
    }
  });

  const normalizedQuestions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!normalizedQuestions.length) {
    throw new ApiError(422, "At least one question is required");
  }

  const scopeByCollege = new Map();
  const skippedColleges = [];

  for (const collegeId of targetCollegeIds) {
    if (assignmentMethod === "department_wise") {
      const scopedDepartments = await db.department.findMany({
        where: {
          id: { in: selectedDepartmentIds },
          collegeId,
        },
        select: { id: true },
      });

      const scopedDepartmentIds = scopedDepartments.map((item) => item.id);
      if (!scopedDepartmentIds.length) {
        skippedColleges.push({ collegeId, reason: "NO_MATCHING_DEPARTMENTS" });
        continue;
      }

      const batches = await db.batch.findMany({
        where: {
          collegeId,
          departmentId: { in: scopedDepartmentIds },
        },
        select: {
          id: true,
        },
      });

      const resolvedBatchIds = batches.map((item) => item.id);
      scopeByCollege.set(collegeId, {
        batchIds: resolvedBatchIds,
        departmentId: scopedDepartmentIds.length === 1 ? scopedDepartmentIds[0] : null,
        assignedTo: scopedDepartmentIds,
      });
      continue;
    }

    const batches = await db.batch.findMany({
      where: {
        id: { in: selectedBatchIds },
        collegeId,
      },
      select: { id: true, departmentId: true },
    });

    const resolvedBatchIds = batches.map((item) => item.id);
    if (!resolvedBatchIds.length) {
      skippedColleges.push({ collegeId, reason: "NO_MATCHING_BATCHES" });
      continue;
    }

    scopeByCollege.set(collegeId, {
      batchIds: resolvedBatchIds,
      departmentId: null,
      assignedTo: [],
    });
  }

  if (!scopeByCollege.has(existing.collegeId)) {
    throw new ApiError(
      422,
      "Selected assignment scope does not include the current test college",
      {
        collegeId: existing.collegeId,
        assignmentMethod,
        selectedDepartmentIds,
        selectedBatchIds,
        skippedColleges,
      },
      "CURRENT_COLLEGE_SCOPE_MISSING"
    );
  }

  let primaryUpdated = null;
  const updatedCollegeIds = [];
  const createdCollegeIds = [];

  await db.$transaction(async (tx) => {
    for (const [collegeId, resolvedScope] of scopeByCollege.entries()) {
      let targetTest = familyTestByCollege.get(collegeId);

      if (targetTest) {
        targetTest = await tx.test.update({
          where: { id: targetTest.id },
          data: {
            title: payload.title,
            subject: payload.subject,
            description: payload.description || null,
            durationMins: payload.durationMins,
            totalMarks: payload.totalMarks,
            attemptsAllowed: payload.attemptsAllowed,
            evaluationRule: payload.evaluationRule,
            assignmentMethod,
            assignedTo: resolvedScope.assignedTo || [],
            startsAt,
            endsAt,
            departmentId: assignmentMethod === "department_wise" ? resolvedScope.departmentId : null,
            batchId: resolvedScope.batchIds[0] || null,
            ...resolvedTestConfiguration.persistenceFields,
          },
        });
        updatedCollegeIds.push(collegeId);
      } else {
        const adminId = adminByCollege.get(collegeId);
        if (!adminId) {
          skippedColleges.push({ collegeId, reason: "NO_ACTIVE_ADMIN" });
          continue;
        }

        targetTest = await tx.test.create({
          data: {
            title: payload.title,
            subject: payload.subject,
            description: payload.description || null,
            durationMins: payload.durationMins,
            totalMarks: payload.totalMarks,
            attemptsAllowed: payload.attemptsAllowed,
            evaluationRule: payload.evaluationRule,
            startsAt,
            endsAt,
            isPublished: existing.isPublished,
            status: existing.status,
            isGlobal: true,
            sourceTestId: rootSourceId,
            assignmentMethod,
            assignedTo: resolvedScope.assignedTo || [],
            collegeId,
            departmentId: assignmentMethod === "department_wise" ? resolvedScope.departmentId : null,
            batchId: resolvedScope.batchIds[0] || null,
            createdByAdminId: adminId,
            ...resolvedTestConfiguration.persistenceFields,
          },
        });
        createdCollegeIds.push(collegeId);
      }

      await tx.testBatch.deleteMany({ where: { testId: targetTest.id } });
      if (resolvedScope.batchIds.length > 0) {
        await tx.testBatch.createMany({
          data: resolvedScope.batchIds.map((batchId) => ({
            testId: targetTest.id,
            batchId,
            collegeId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.question.deleteMany({ where: { testId: targetTest.id } });
      await tx.question.createMany({
        data: normalizedQuestions.map((question, index) => ({
          testId: targetTest.id,
          collegeId,
          prompt: question.prompt,
          type: question.type,
          options: question.options || [],
          correctOption: question.correctOption || null,
          correctBoolean: question.correctBoolean ?? null,
          correctText: question.correctText || null,
          marks: question.marks || 1,
          order: index + 1,
        })),
      });

      if (collegeId === existing.collegeId) {
        primaryUpdated = targetTest;
      }
    }
  });

  if (!primaryUpdated) {
    throw new ApiError(500, "Failed to update primary test record", null, "PRIMARY_UPDATE_FAILED");
  }

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_TEST",
    targetType: "TEST",
    targetId: primaryUpdated.id,
    collegeId: primaryUpdated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: {
      title: primaryUpdated.title,
      subject: primaryUpdated.subject,
      status: primaryUpdated.status,
      assignmentMethod,
      updatedCollegeIds,
      createdCollegeIds,
      skippedColleges,
      questionCount: normalizedQuestions.length,
      testType: resolvedTestConfiguration.testType,
      proctoringPreset: resolvedTestConfiguration.proctoringPreset,
    },
    testId: primaryUpdated.id,
  });

  const hydrated = await db.test.findUnique({
    where: { id: primaryUpdated.id },
    include: {
      college: true,
      department: true,
      questions: {
        orderBy: { order: "asc" },
      },
      batchAssignments: {
        select: {
          batchId: true,
          batch: {
            select: {
              id: true,
              name: true,
              year: true,
              departmentId: true,
              collegeId: true,
            },
          },
        },
      },
      _count: {
        select: {
          questions: true,
          submissions: true,
        },
      },
    },
  });

  res.status(200).json({
    ...attachResolvedTestConfiguration(hydrated),
    propagation: {
      updatedCollegeIds,
      createdCollegeIds,
      skippedColleges,
    },
  });
});

const transitionGlobalTestStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const { action } = req.body;

  const existing = await db.test.findUnique({ where: { id: testId } });
  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const currentStatus = deriveLifecycleStatus(existing);
  const nextStatus = resolveTransitionTarget(action);

  if (action === TRANSITION_ACTION.GO_LIVE && existing.startsAt && new Date(existing.startsAt) > new Date()) {
    throw new ApiError(422, "Cannot publish live before start date", null, "LIVE_BEFORE_START_NOT_ALLOWED");
  }

  assertTransition(currentStatus, nextStatus);

  const updated = await db.test.update({
    where: { id: testId },
    data: {
      status: nextStatus,
      isPublished: nextStatus !== TEST_STATUS.ARCHIVED,
    },
  });

  await createAuditLog({
    action: transitionAuditAction(action),
    targetType: "TEST",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      status: currentStatus,
      isPublished: existing.isPublished,
    },
    afterState: {
      status: updated.status,
      isPublished: updated.isPublished,
      transitionAction: action,
    },
    testId: updated.id,
  });

  res.status(200).json(updated);
});

const deactivateTest = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { testId } = req.params;
  const existing = await db.test.findUnique({ where: { id: testId } });

  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const submissionCount = await db.submission.count({ where: { testId } });
  if (submissionCount > 0) {
    throw new ApiError(
      409,
      "Cannot delete test with submissions. Archive it instead to preserve reporting integrity.",
      { testId, submissionCount, suggestedAction: TRANSITION_ACTION.ARCHIVE },
      "TEST_DELETE_BLOCKED"
    );
  }

  await db.$transaction(async (tx) => {
    const submissions = await tx.submission.findMany({
      where: { testId },
      select: { id: true },
    });
    const submissionIds = submissions.map((item) => item.id);

    await tx.testSession.deleteMany({ where: { testId } });
    if (submissionIds.length > 0) {
      await tx.answer.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.violation.deleteMany({ where: { submissionId: { in: submissionIds } } });
    }
    await tx.submission.deleteMany({ where: { testId } });
    await tx.question.deleteMany({ where: { testId } });
    await tx.testBatch.deleteMany({ where: { testId } });
    await tx.test.delete({ where: { id: testId } });
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DELETE_TEST",
    targetType: "TEST",
    targetId: existing.id,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: { deleted: true },
    testId: existing.id,
  });

  res.status(200).json({ message: "Test deleted", id: existing.id });
});

module.exports = {
  getTestsGlobal,
  getGlobalTestById,
  createGlobalTest,
  cloneTestToCollege,
  updateGlobalTest,
  transitionGlobalTestStatus,
  deactivateTest,
};
