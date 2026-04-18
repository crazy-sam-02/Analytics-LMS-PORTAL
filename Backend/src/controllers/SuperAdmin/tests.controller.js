const prisma = require("../../config/db");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");

const getTestsGlobal = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const collegeId = req.query.collegeId;
  const search = (req.query.search || "").trim();
  const status = (req.query.status || "").trim();

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(status && status.toUpperCase() !== "ALL" ? { status: status.toUpperCase() } : {}),
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
    prisma.test.findMany({
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
    prisma.test.count({ where }),
  ]);

  res.status(200).json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

const createGlobalTest = asyncHandler(async (req, res) => {
  const payload = req.body;
  let collegeIds = Array.isArray(payload.collegeIds) ? payload.collegeIds : [];
  const assignmentMethod = payload.assignmentMethod || "department_wise";
  const requestedBatchIds = Array.isArray(payload.batchIds) ? payload.batchIds : [];
  const requestedDepartmentIds = Array.isArray(payload.departmentIds) ? payload.departmentIds : [];

  if (payload.allColleges) {
    const colleges = await prisma.college.findMany({ where: { isActive: true }, select: { id: true } });
    collegeIds = colleges.map((item) => item.id);
  }

  if (!collegeIds.length) {
    throw new ApiError(400, "At least one college must be targeted");
  }

  const admins = await prisma.admin.findMany({
    where: {
      collegeId: { in: collegeIds },
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

  const candidateBatches = await prisma.batch.findMany({
    where: {
      collegeId: { in: collegeIds },
      ...(assignmentMethod === "batch_wise"
        ? { id: { in: requestedBatchIds } }
        : requestedDepartmentIds.length
          ? { departmentId: { in: requestedDepartmentIds } }
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

  const created = [];

  for (const collegeId of collegeIds) {
    const eligibleBatches = batchesByCollege.get(collegeId) || [];
    const resolvedBatchIds = eligibleBatches.map((item) => item.id);

    if (!resolvedBatchIds.length) {
      continue;
    }

    const admin = adminByCollege.get(collegeId);

    if (!admin) {
      continue;
    }

    const resolvedDepartmentId =
      assignmentMethod === "department_wise" && requestedDepartmentIds.length === 1
        ? eligibleBatches.find((batch) => batch.departmentId === requestedDepartmentIds[0])?.departmentId || null
        : null;

    const test = await prisma.test.create({
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
        status: "UPCOMING",
        isGlobal: true,
        collegeId,
        batchId: resolvedBatchIds[0] || null,
        createdByAdminId: admin.id,
        violationLimit: 3,
        departmentId: resolvedDepartmentId,
      },
    });

    await prisma.testBatch.createMany({
      data: resolvedBatchIds.map((batchId) => ({
        testId: test.id,
        batchId,
        collegeId,
      })),
      skipDuplicates: true,
    });

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
      await prisma.question.createMany({ data: questionRows });
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
      colleges: collegeIds,
      createdCount: created.length,
    },
  });

  res.status(201).json({
    message: "Global test created",
    data: created,
  });
});

const cloneTestToCollege = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const {
    destinationCollegeId,
    assignmentMethod = "batch_wise",
    departmentIds = [],
    batchIds = [],
  } = req.body;

  const source = await prisma.test.findUnique({
    where: { id: testId },
    include: { questions: { orderBy: { order: "asc" } } },
  });

  if (!source) {
    throw new ApiError(404, "Source test not found");
  }

  const admin = await prisma.admin.findFirst({
    where: {
      collegeId: destinationCollegeId,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!admin) {
    throw new ApiError(400, "Destination college must have an active admin");
  }

  let resolvedDepartmentIds = [];
  let resolvedBatchIds = [];

  if (assignmentMethod === "department_wise") {
    const departments = await prisma.department.findMany({
      where: {
        id: { in: departmentIds },
        collegeId: destinationCollegeId,
      },
      select: { id: true },
    });

    resolvedDepartmentIds = departments.map((item) => item.id);

    if (!resolvedDepartmentIds.length) {
      throw new ApiError(422, "No valid departments found in the destination college");
    }

    const eligibleBatches = await prisma.batch.findMany({
      where: {
        collegeId: destinationCollegeId,
        departmentId: { in: resolvedDepartmentIds },
      },
      select: { id: true },
    });

    resolvedBatchIds = eligibleBatches.map((item) => item.id);

    if (!resolvedBatchIds.length) {
      throw new ApiError(422, "Selected departments do not have any batches in the destination college");
    }
  } else {
    const eligibleBatches = await prisma.batch.findMany({
      where: {
        id: { in: batchIds },
        collegeId: destinationCollegeId,
      },
      select: {
        id: true,
        departmentId: true,
      },
    });

    resolvedBatchIds = eligibleBatches.map((item) => item.id);

    if (!resolvedBatchIds.length) {
      throw new ApiError(422, "No valid batches found in the destination college");
    }

    resolvedDepartmentIds = [...new Set(eligibleBatches.map((item) => item.departmentId).filter(Boolean))];
  }

  const cloned = await prisma.test.create({
    data: {
      title: `${source.title} (Cloned)`,
      subject: source.subject,
      description: source.description,
      durationMins: source.durationMins,
      totalMarks: source.totalMarks,
      attemptsAllowed: source.attemptsAllowed,
      evaluationRule: source.evaluationRule,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      isPublished: false,
      status: "DRAFT",
      isGlobal: source.isGlobal,
      sourceTestId: source.id,
      collegeId: destinationCollegeId,
      departmentId: resolvedDepartmentIds[0] || null,
      batchId: resolvedBatchIds[0] || null,
      createdByAdminId: admin.id,
      violationLimit: source.violationLimit,
      restrictTabSwitch: source.restrictTabSwitch,
      restrictCopyPaste: source.restrictCopyPaste,
      restrictRightClick: source.restrictRightClick,
      requireFullscreen: source.requireFullscreen,
    },
  });

  if (source.questions.length > 0) {
    await prisma.question.createMany({
      data: source.questions.map((question) => ({
        testId: cloned.id,
        collegeId: destinationCollegeId,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
        correctOption: question.correctOption,
        correctBoolean: question.correctBoolean,
        correctText: question.correctText,
        marks: question.marks,
        order: question.order,
      })),
    });
  }

  await prisma.testBatch.createMany({
    data: resolvedBatchIds.map((batchId) => ({
      testId: cloned.id,
      batchId,
      collegeId: destinationCollegeId,
    })),
    skipDuplicates: true,
  });

  await createAuditLog({
    action: "SUPER_ADMIN_CLONE_TEST",
    targetType: "TEST",
    targetId: cloned.id,
    collegeId: destinationCollegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      sourceTestId: source.id,
      destinationCollegeId,
      assignmentMethod,
      departmentIds: resolvedDepartmentIds,
      batchIds: resolvedBatchIds,
    },
  });

  res.status(201).json(cloned);
});

const deactivateTest = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const existing = await prisma.test.findUnique({ where: { id: testId } });

  if (!existing) {
    throw new ApiError(404, "Test not found");
  }

  const test = await prisma.test.update({
    where: { id: testId },
    data: {
      status: "ARCHIVED",
      isPublished: false,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DEACTIVATE_TEST",
    targetType: "TEST",
    targetId: test.id,
    collegeId: test.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: test,
    testId: test.id,
  });

  res.status(200).json(test);
});

module.exports = {
  getTestsGlobal,
  createGlobalTest,
  cloneTestToCollege,
  deactivateTest,
};
