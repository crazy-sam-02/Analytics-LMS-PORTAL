const prisma = require("../../config/db");
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
    prisma.batch.findMany({
      where,
      include: {
        college: true,
        department: true,
        _count: {
          select: {
            students: true,
            tests: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.batch.count({ where }),
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

  const test = await prisma.test.findUnique({ where: { id: testId } });
  if (!test) {
    throw new ApiError(404, "Test not found");
  }

  const validBatches = await prisma.batch.findMany({
    where: {
      id: { in: requestedBatchIds },
    },
    select: { id: true, collegeId: true },
  });

  const validBatchIds = new Set(validBatches.map((batch) => String(batch.id)));
  const invalidBatchIds = requestedBatchIds.filter((id) => !validBatchIds.has(String(id)));

  if (!validBatches.length) {
    throw new ApiError(400, "No valid batches found", { invalidBatchIds });
  }

  const existingAssignments = await prisma.testBatch.findMany({
    where: {
      testId,
      batchId: { in: [...validBatchIds] },
    },
    select: { batchId: true },
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
    await prisma.testBatch.createMany({
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

  const college = await prisma.college.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Batch cannot be created for inactive or missing college");
  }

  const department = await prisma.department.findFirst({
    where: {
      id: departmentId,
      collegeId,
    },
  });

  if (!department) {
    throw new ApiError(422, "Invalid department for selected college");
  }

  const duplicate = await prisma.batch.findFirst({
    where: {
      collegeId,
      departmentId,
      year,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new ApiError(409, "Duplicate batch name for the same department and academic year", null, "BATCH_DUPLICATE_NAME");
  }

  const batch = await prisma.batch.create({
    data: {
      name,
      year,
      collegeId,
      departmentId,
    },
    include: {
      college: true,
      department: true,
      _count: {
        select: { students: true, tests: true },
      },
    },
  });

  if (Array.isArray(studentIds) && studentIds.length > 0) {
    await prisma.student.updateMany({
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
  const existing = await prisma.batch.findUnique({ where: { id: batchId } });

  if (!existing) {
    throw new ApiError(404, "Batch not found");
  }

  const nextName = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
  const nextYear = req.body.year !== undefined ? Number(req.body.year) : existing.year;
  const nextDepartmentId = req.body.departmentId !== undefined ? req.body.departmentId : existing.departmentId;

  const department = await prisma.department.findFirst({
    where: {
      id: nextDepartmentId,
      collegeId: existing.collegeId,
    },
    select: { id: true },
  });

  if (!department) {
    throw new ApiError(422, "Invalid department for selected batch college");
  }

  const duplicate = await prisma.batch.findFirst({
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

  const updated = await prisma.batch.update({
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

  const existing = await prisma.batch.findUnique({
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

  const result = await prisma.$transaction(async (tx) => {
    const removedAssignments = await tx.testBatch.deleteMany({ where: { batchId } });

    const detachedLegacyTests = await tx.test.updateMany({
      where: { batchId },
      data: { batchId: null },
    });

    const detachedStudents = await tx.student.updateMany({
      where: { batchId },
      data: { batchId: null },
    });

    await tx.batch.delete({ where: { id: batchId } });

    return {
      removedAssignments: removedAssignments.count,
      detachedLegacyTests: detachedLegacyTests.count,
      detachedStudents: detachedStudents.count,
    };
  });

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
