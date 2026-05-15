const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");

const getBatchesGlobal = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const collegeId = req.query.collegeId;
  const search = (req.query.search || "").trim();

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            {
              department: {
                name: { contains: search, mode: "insensitive" },
              },
            },
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
    (async () => {
      const m = await models.init();
      return m.dbClient.batch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
    })(),
    (async () => {
      const m = await models.init();
      return m.dbClient.batch.count({ where });
    })(),
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

const assignTestToBatches = asyncHandler(async (req, res) => {
  const { testId, batchIds = [] } = req.body;

  if (!testId) {
    throw new ApiError(400, "testId is required");
  }

  const requestedBatchIds = [...new Set((Array.isArray(batchIds) ? batchIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!requestedBatchIds.length) {
    throw new ApiError(400, "At least one batchId is required");
  }

  const m = await models.init();
  const Test = m.dbClient.test;
  const Batch = m.dbClient.batch;

  const test = await Test.findUnique({ where: { id: testId } });
  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const validBatches = await Batch.findMany({
    where: {
      id: { in: requestedBatchIds },
    },
  });

  const validBatchIds = new Set(validBatches.map((batch) => String(batch.id)));
  const invalidBatchIds = requestedBatchIds.filter((id) => !validBatchIds.has(String(id)));

  if (!validBatches.length) {
    throw new ApiError(400, "No valid batches found", { invalidBatchIds });
  }

  const TestBatch = m.dbClient.testBatch;
  const existingAssignments = await TestBatch.findMany({
    where: {
      testId,
      batchId: { in: [...validBatchIds] },
    },
  });

  const existingBatchIds = new Set(existingAssignments.map((item) => String(item.batchId)));

  const assignments = validBatches
    .filter((batch) => !existingBatchIds.has(String(batch.id)))
    .map((batch) => ({
    testId,
    batchId: batch.id,
    collegeId: batch.collegeId,
    }));

  if (assignments.length > 0) {
    const m2 = await models.init();
    const TestBatch = m2.dbClient.testBatch;
    await TestBatch.createMany({
      data: assignments,
    });
  }

  res.status(200).json({
    message: "Batch assignments updated",
    requested: requestedBatchIds.length,
    assigned: assignments.length,
    alreadyAssigned: existingBatchIds.size,
    invalidBatchIds,
  });
});

const createBatchGlobal = asyncHandler(async (req, res) => {
  const { name, year, collegeId, departmentId, studentIds = [] } = req.body;

  const m = await models.init();
  const College = m.dbClient.college;
  const Department = m.dbClient.department;
  const Batch = m.dbClient.batch;
  const Student = m.dbClient.student;

  const college = await College.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Batch cannot be created for inactive or missing college");
  }

  const department = await Department.findFirst({
    where: {
      id: departmentId,
      collegeId,
    },
  });

  if (!department) {
    throw new ApiError(422, "Invalid department for selected college");
  }

  const duplicate = await Batch.findFirst({
    where: {
      collegeId,
      departmentId,
      year,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (duplicate) {
    throw new ApiError(409, "Duplicate batch name for the same department and academic year", null, "BATCH_DUPLICATE_NAME");
  }

  const batch = await Batch.create({
    data: {
      name,
      year,
      collegeId,
      departmentId,
    },
  });

  if (Array.isArray(studentIds) && studentIds.length > 0) {
    await Student.updateMany({
      where: {
        id: { in: studentIds },
        collegeId,
      },
      data: {
        batchId: batch.id,
        departmentId,
      },
    });
  }

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_CREATED",
    targetType: "BATCH",
    targetId: batch.id,
    collegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      name: batch.name,
      year: batch.year,
      departmentId: batch.departmentId,
    },
  });

  res.status(201).json(batch);
});

const updateBatchGlobal = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const m = await models.init();
  const db = m.dbClient;
  
  const existing = await db.batch.findUnique({ where: { id: batchId } });

  if (!existing) {
    throw new ApiError(404, "Batch not found");
  }

  const nextName = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
  const nextYear = req.body.year !== undefined ? Number(req.body.year) : existing.year;
  const nextDepartmentId = req.body.departmentId !== undefined ? req.body.departmentId : existing.departmentId;

  const department = await db.department.findFirst({
    where: {
      id: nextDepartmentId,
      collegeId: existing.collegeId,
    },
    select: { id: true },
  });

  if (!department) {
    throw new ApiError(422, "Invalid department for selected batch college");
  }

  const duplicate = await db.batch.findFirst({
    where: {
      id: { not: batchId },
      collegeId: existing.collegeId,
      departmentId: nextDepartmentId,
      year: nextYear,
      name: {
        equals: nextName,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new ApiError(409, "Duplicate batch name for the same department and academic year", null, "BATCH_DUPLICATE_NAME");
  }

  const updated = await db.batch.update({
    where: { id: batchId },
    data: {
      ...(req.body.name !== undefined ? { name: nextName } : {}),
      ...(req.body.year !== undefined ? { year: nextYear } : {}),
      ...(req.body.departmentId !== undefined ? { departmentId: nextDepartmentId } : {}),
      ...(req.body.isArchived !== undefined ? { isArchived: req.body.isArchived } : {}),
    },
    include: {
      college: true,
      department: true,
      _count: {
        select: { students: true, tests: true },
      },
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_UPDATED",
    targetType: "BATCH",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      name: existing.name,
      year: existing.year,
      departmentId: existing.departmentId,
      isArchived: existing.isArchived,
    },
    afterState: {
      name: updated.name,
      year: updated.year,
      departmentId: updated.departmentId,
      isArchived: updated.isArchived,
    },
  });

  res.status(200).json(updated);
});

const deleteBatchGlobal = asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  const { confirmationText } = req.body;
  const m = await models.init();
  const db = m.dbClient;

  const existing = await db.batch.findUnique({
    where: { id: batchId },
    include: {
      _count: {
        select: { students: true, tests: true, testAssignments: true },
      },
    },
  });

  if (!existing) {
    throw new ApiError(404, "Batch not found");
  }

  const expectedConfirmation = `DELETE ${existing.name}`;
  if (confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  // Perform delete operations sequentially (no transaction support in native MongoDB client wrapper)
  const removedAssignments = await db.testBatch.deleteMany({ where: { batchId } });

  const detachedLegacyTests = await db.test.updateMany({
    where: { batchId },
    data: { batchId: null },
  });

  const detachedStudents = await db.student.updateMany({
    where: { batchId },
    data: { batchId: null },
  });

  await db.batch.delete({ where: { id: batchId } });

  const result = {
    removedAssignments: removedAssignments.count || 0,
    detachedLegacyTests: detachedLegacyTests.count || 0,
    detachedStudents: detachedStudents.count || 0,
  };

  await createAuditLog({
    action: "SUPER_ADMIN_BATCH_DELETED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      name: existing.name,
      testAssignments: existing._count.testAssignments,
      tests: existing._count.tests,
      students: existing._count.students,
    },
    afterState: {
      deleted: true,
      ...result,
    },
  });

  res.status(200).json({
    message: "Batch deleted",
    ...result,
  });
});

module.exports = {
  getBatchesGlobal,
  assignTestToBatches,
  createBatchGlobal,
  updateBatchGlobal,
  deleteBatchGlobal,
};
