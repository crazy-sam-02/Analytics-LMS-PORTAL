const prisma = require("../../config/db");
const { ApiError, asyncHandler } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");

const parseCsv = (csvText) => {
  const rows = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) return [];

  const headers = rows[0].split(",").map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    const record = {};
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

const getBatches = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;

  const batches = await prisma.batch.findMany({
    where: { collegeId },
    include: {
      department: true,
      _count: {
        select: {
          students: true,
          testAssignments: true,
        },
      },
    },
    orderBy: [{ year: "desc" }, { name: "asc" }],
  });

  res.status(200).json(batches);
});

const getBatchDetail = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await prisma.batch.findFirst({
    where: { id: batchId, collegeId },
    include: {
      department: true,
      students: {
        include: {
          _count: {
            select: { submissions: true },
          },
        },
        orderBy: { fullName: "asc" },
      },
      testAssignments: {
        include: {
          test: {
            select: {
              id: true,
              title: true,
              subject: true,
              startsAt: true,
              endsAt: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  res.status(200).json(batch);
});

const createBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { name, year, departmentId, studentIds } = req.body;

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
  });

  if (duplicate) {
    throw new ApiError(409, "Duplicate batch name for the same department and academic year", null, "BATCH_DUPLICATE_NAME");
  }

  const department = await prisma.department.findFirst({
    where: { id: departmentId, collegeId },
  });

  if (!department) {
    throw new ApiError(422, "Invalid department for this college");
  }

  const batch = await prisma.batch.create({
    data: {
      name,
      year,
      departmentId,
      collegeId,
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
    action: "ADMIN_BATCH_CREATED",
    targetType: "BATCH",
    targetId: batch.id,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      name: batch.name,
      year: batch.year,
      departmentId: batch.departmentId,
    },
  });

  res.status(201).json(batch);
});

const assignStudentsToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { batchId } = req.params;
  const { studentIds } = req.body;

  const batch = await prisma.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  const result = await prisma.student.updateMany({
    where: {
      id: { in: studentIds },
      collegeId,
    },
    data: {
      batchId,
      departmentId: batch.departmentId,
    },
  });

  await createAuditLog({
    action: "ADMIN_BATCH_STUDENTS_ASSIGNED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      studentIds,
      count: result.count,
    },
  });

  res.status(200).json({ message: "Students assigned", updated: result.count });
});

const bulkAddStudentsToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { batchId } = req.params;
  const { csvData, studentIds = [] } = req.body;

  const batch = await prisma.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  const parsedRows = csvData ? parseCsv(csvData) : [];
  const fromCsvEmails = parsedRows.map((row) => row.email).filter(Boolean);
  const fromCsvStudentIds = parsedRows.map((row) => row.studentid || row.student_id).filter(Boolean);

  const csvStudents = parsedRows.length
    ? await prisma.student.findMany({
        where: {
          collegeId,
          OR: [
            ...(fromCsvEmails.length ? [{ email: { in: fromCsvEmails } }] : []),
            ...(fromCsvStudentIds.length ? [{ studentId: { in: fromCsvStudentIds } }] : []),
          ],
        },
      })
    : [];

  const studentPool = new Map();
  csvStudents.forEach((student) => studentPool.set(student.id, student));

  if (Array.isArray(studentIds) && studentIds.length > 0) {
    const byIds = await prisma.student.findMany({ where: { id: { in: studentIds }, collegeId } });
    byIds.forEach((student) => studentPool.set(student.id, student));
  }

  const finalIds = [...studentPool.keys()];
  if (finalIds.length === 0) {
    throw new ApiError(422, "No valid students found from CSV/IDs");
  }

  const update = await prisma.student.updateMany({
    where: { id: { in: finalIds }, collegeId },
    data: {
      batchId,
      departmentId: batch.departmentId,
    },
  });

  await createAuditLog({
    action: "ADMIN_BATCH_BULK_STUDENTS_ADDED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      updated: update.count,
      studentCount: finalIds.length,
    },
  });

  res.status(200).json({
    message: "Bulk student assignment completed",
    updated: update.count,
    requested: finalIds.length,
  });
});

const removeStudentFromBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { batchId, studentId } = req.params;

  const [batch, student] = await Promise.all([
    prisma.batch.findFirst({ where: { id: batchId, collegeId } }),
    prisma.student.findFirst({ where: { id: studentId, collegeId } }),
  ]);

  if (!batch || !student || student.batchId !== batchId) {
    throw new ApiError(404, "Batch or student not found");
  }

  const activeSubmission = await prisma.submission.findFirst({
    where: {
      userId: studentId,
      status: "IN_PROGRESS",
      test: {
        OR: [
          { batchId },
          { batchAssignments: { some: { batchId } } },
        ],
      },
    },
    include: {
      test: {
        select: { id: true, title: true },
      },
    },
  });

  if (activeSubmission) {
    return res.status(409).json({
      message: "Cannot remove student with active test",
      warning: {
        type: "ACTIVE_TEST_PRESENT",
        testId: activeSubmission.test?.id,
        testTitle: activeSubmission.test?.title,
      },
    });
  }

  await prisma.student.update({
    where: { id: studentId },
    data: { batchId: null },
  });

  await createAuditLog({
    action: "ADMIN_BATCH_STUDENT_REMOVED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      studentId,
      batchId,
    },
    afterState: {
      studentId,
      batchId: null,
    },
  });

  res.status(200).json({ message: "Student removed from batch" });
});

const assignTestToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { testId } = req.params;
  const { batchId } = req.body;

  const [test, batch] = await Promise.all([
    prisma.test.findFirst({ where: { id: testId, collegeId } }),
    prisma.batch.findFirst({ where: { id: batchId, collegeId } }),
  ]);

  if (!test || !batch) {
    throw new ApiError(404, "Test or batch not found");
  }

  await prisma.testBatch.upsert({
    where: {
      testId_batchId: {
        testId,
        batchId,
      },
    },
    update: {
      collegeId,
    },
    create: {
      testId,
      batchId,
      collegeId,
    },
  });

  await createAuditLog({
    action: "ADMIN_TEST_BATCH_ASSIGNED",
    targetType: "TEST",
    targetId: testId,
    collegeId,
    adminId: req.admin.id,
    testId,
    afterState: { batchId },
  });

  res.status(200).json({ message: "Test assigned to batch" });
});

const archiveBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await prisma.batch.findFirst({ where: { id: batchId, collegeId } });
  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  const now = new Date();
  const futureTests = await prisma.test.findMany({
    where: {
      collegeId,
      startsAt: { gt: now },
      OR: [
        { batchId },
        { batchAssignments: { some: { batchId } } },
      ],
    },
    select: { id: true },
  });

  const futureIds = futureTests.map((item) => item.id);
  if (futureIds.length > 0) {
    await prisma.testBatch.deleteMany({
      where: {
        batchId,
        testId: { in: futureIds },
      },
    });

    await prisma.test.updateMany({
      where: {
        id: { in: futureIds },
        batchId,
      },
      data: {
        batchId: null,
      },
    });
  }

  const archived = await prisma.batch.update({
    where: { id: batchId },
    data: { isArchived: true },
  });

  await createAuditLog({
    action: "ADMIN_BATCH_ARCHIVED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      removedFromFutureTests: futureIds.length,
    },
  });

  res.status(200).json({ message: "Batch archived", batch: archived, detachedFutureTests: futureIds.length });
});

const deleteBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await prisma.batch.findFirst({
    where: { id: batchId, collegeId },
    include: {
      _count: {
        select: { testAssignments: true, tests: true, students: true },
      },
    },
  });

  if (!batch) {
    throw new ApiError(404, "Batch not found");
  }

  const result = await prisma.$transaction(async (tx) => {
    const removedAssignments = await tx.testBatch.deleteMany({
      where: {
        batchId,
        collegeId,
      },
    });

    const detachedLegacyTests = await tx.test.updateMany({
      where: {
        collegeId,
        batchId,
      },
      data: {
        batchId: null,
      },
    });

    const detachedStudents = await tx.student.updateMany({
      where: {
        collegeId,
        batchId,
      },
      data: {
        batchId: null,
      },
    });

    await tx.batch.delete({ where: { id: batchId } });

    return {
      removedAssignments: removedAssignments.count,
      detachedLegacyTests: detachedLegacyTests.count,
      detachedStudents: detachedStudents.count,
    };
  });

  await createAuditLog({
    action: "ADMIN_BATCH_DELETED",
    targetType: "BATCH",
    targetId: batchId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      testAssignments: batch._count.testAssignments,
      tests: batch._count.tests,
      students: batch._count.students,
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
  getBatches,
  getBatchDetail,
  createBatch,
  assignStudentsToBatch,
  bulkAddStudentsToBatch,
  removeStudentFromBatch,
  assignTestToBatch,
  archiveBatch,
  deleteBatch,
};
