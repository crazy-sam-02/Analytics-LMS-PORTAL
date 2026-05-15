const models = require("../../models");
const bcrypt = require("bcrypt");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");

const createStudentPassword = (fullName, enrollNumber) => {
  const nameLetters = String(fullName || "").replace(/[^a-zA-Z]/g, "");
  const baseName = (nameLetters.slice(0, 3) || "Stu").padEnd(3, "x");
  const namePart = `${baseName.charAt(0).toUpperCase()}${baseName.slice(1).toLowerCase()}`;

  const enrollDigits = String(enrollNumber || "").replace(/\D/g, "");
  if (enrollDigits.length < 3) {
    throw new ApiError(400, "Enroll number must contain at least 3 digits");
  }

  return `${namePart}@${enrollDigits.slice(-3)}`;
};

const generateUniqueStudentId = async (collegeId, seedValue = "") => {
  const m = await models.init();
  const db = m.dbClient;
  const seedDigits = String(seedValue || "").replace(/\D/g, "");
  const suffix = (seedDigits.slice(-4) || `${Date.now()}`.slice(-4)).padStart(4, "0");

  let index = 0;
  while (index < 500) {
    const candidate = index === 0 ? `STD-${suffix}` : `STD-${suffix}-${String(index).padStart(2, "0")}`;
    const exists = await db.student.findFirst({
      where: {
        collegeId,
        studentId: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }

    index += 1;
  }

  throw new ApiError(500, "Unable to generate unique student id");
};

const parseCsv = (csvText) => {
  const rows = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) return [];

  const headers = rows[0].split(",").map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((line, rowIndex) => {
    const values = line.split(",").map((value) => value.trim());
    const record = { __row: rowIndex + 2 };
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value || "").trim();
    }
  }
  return "";
};

const processBulkImportJob = async ({ jobId, collegeId, superAdminId, csvData }) => {
  const m = await models.init();
  const db = m.dbClient;
  const rows = parseCsv(csvData);
  const result = {
    created: 0,
    failed: 0,
    duplicates: 0,
    errors: [],
  };

  try {
    await db.reportJob.update({
      where: { id: jobId },
      data: {
        status: "PROCESSING",
      },
    });

    for (const row of rows) {
      const fullName = getRowValue(row, ["fullName", "fullname", "name", "studentName"]);
      const email = getRowValue(row, ["email", "emailAddress"]);
      const requestedStudentId = getRowValue(row, ["studentId", "student_id", "rollNo", "rollNumber"]);
      const enrollNumber = getRowValue(row, ["enrollNumber", "enroll_number", "enrollmentNumber", "enrollment_no"]) || requestedStudentId;
      const departmentLookup = getRowValue(row, ["departmentId", "department_id", "department", "departmentName"]);
      const batchLookup = getRowValue(row, ["batchId", "batch_id", "batch", "batchName"]);

      if (!fullName || !email || !departmentLookup || !enrollNumber) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Missing required columns" });
        continue;
      }

      const duplicateEmail = await db.student.findFirst({
        where: {
          collegeId,
          email,
        },
      });

      const duplicateStudentId = requestedStudentId
        ? await db.student.findFirst({
            where: {
              collegeId,
              studentId: requestedStudentId,
            },
          })
        : null;

      if (duplicateEmail || duplicateStudentId) {
        result.duplicates += 1;
        result.errors.push({ row: row.__row, reason: duplicateEmail ? "Duplicate email" : "Duplicate student id" });
        continue;
      }

      const departmentById = await db.department.findFirst({
        where: {
          id: departmentLookup,
          collegeId,
        },
      });

      const department = departmentById || await db.department.findFirst({
        where: {
          collegeId,
          name: {
            equals: departmentLookup,
            mode: "insensitive",
          },
        },
      });

      if (!department) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Invalid department" });
        continue;
      }

      let batch = null;
      if (batchLookup) {
        const batchById = await db.batch.findFirst({
          where: {
            id: batchLookup,
            collegeId,
            departmentId: department.id,
          },
        });

        batch = batchById || await db.batch.findFirst({
          where: {
            collegeId,
            departmentId: department.id,
            name: {
              equals: batchLookup,
              mode: "insensitive",
            },
          },
        });
      }

      const generatedPassword = createStudentPassword(fullName, enrollNumber);
      const passwordHash = await bcrypt.hash(generatedPassword, 10);
      const studentId = requestedStudentId || await generateUniqueStudentId(collegeId, enrollNumber);

      await db.student.create({
        data: {
          fullName,
          email,
          studentId,
          passwordHash,
          collegeId,
          departmentId: department.id,
          batchId: batch?.id || null,
        },
      });

      result.created += 1;
    }

    await db.reportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        filters: {
          type: "SUPER_STUDENT_IMPORT",
          result,
          completedAt: new Date().toISOString(),
          initiatedBySuperAdminId: superAdminId,
        },
      },
    });

    await createAuditLog({
      action: "SUPER_ADMIN_STUDENT_BULK_IMPORT_COMPLETED",
      targetType: "STUDENT_IMPORT",
      targetId: jobId,
      collegeId,
      superAdminId,
      afterState: result,
    });
  } catch (error) {
    await db.reportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        filters: {
          type: "SUPER_STUDENT_IMPORT",
          result,
          failedAt: new Date().toISOString(),
          initiatedBySuperAdminId: superAdminId,
          error: error?.message || "Unknown failure",
        },
      },
    });
  }
};

const getStudentsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const search = (req.query.search || "").trim();
  const { collegeId, departmentId, batchId } = req.query;

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(batchId ? { batchId } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { studentId: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.student.findMany({
      where,
      include: {
        college: true,
        department: true,
        batch: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.student.count({ where }),
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

const toggleStudentStatus = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { studentId } = req.params;
  const existing = await db.student.findUnique({ where: { id: studentId } });

  if (!existing) {
    throw new ApiError(404, "Student not found");
  }

  if (req.body.isActive === false) {
    const expectedConfirmation = `BLOCK ${existing.studentId || existing.id}`;
    if (req.body?.confirmationText !== expectedConfirmation) {
      throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
    }
  }

  const student = await db.student.update({
    where: { id: studentId },
    data: { isActive: req.body.isActive },
  });

  await createAuditLog({
    action: req.body.isActive ? "SUPER_ADMIN_UNBLOCK_STUDENT" : "SUPER_ADMIN_BLOCK_STUDENT",
    targetType: "STUDENT",
    targetId: student.id,
    collegeId: student.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: { isActive: existing.isActive },
    afterState: { isActive: student.isActive },
  });

  res.status(200).json(student);
});

const createStudentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;
  const { fullName, email, enrollNumber, collegeId, departmentId, department, batchId } = req.body;

  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Student cannot be created for inactive or missing college");
  }

  const duplicateEmail = await db.student.findFirst({ where: { collegeId, email } });
  if (duplicateEmail) {
    throw new ApiError(409, "Student with this email already exists");
  }

  let departmentRecord = null;
  if (departmentId) {
    departmentRecord = await db.department.findFirst({ where: { id: departmentId, collegeId } });
  }

  if (!departmentRecord && department) {
    departmentRecord = await db.department.findFirst({
      where: {
        collegeId,
        name: {
          equals: department,
          mode: "insensitive",
        },
      },
    });
  }

  if (!departmentRecord) {
    throw new ApiError(404, "Department not found");
  }

  let resolvedBatchId = null;
  if (batchId) {
    const batch = await db.batch.findFirst({
      where: {
        id: batchId,
        collegeId,
        departmentId: departmentRecord.id,
      },
    });

    if (!batch) {
      throw new ApiError(404, "Batch not found for selected department");
    }

    resolvedBatchId = batch.id;
  }

  const generatedStudentId = await generateUniqueStudentId(collegeId, enrollNumber);
  const plainPassword = createStudentPassword(fullName, enrollNumber);
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const student = await db.student.create({
    data: {
      fullName,
      email,
      studentId: generatedStudentId,
      passwordHash,
      collegeId,
      departmentId: departmentRecord.id,
      batchId: resolvedBatchId,
    },
    include: {
      college: true,
      department: true,
      batch: true,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_STUDENT_CREATED",
    targetType: "STUDENT",
    targetId: student.id,
    collegeId,
    superAdminId,
    afterState: {
      email: student.email,
      studentId: student.studentId,
      departmentId: student.departmentId,
      batchId: student.batchId,
    },
  });

  res.status(201).json({
    student,
    credentials: {
      identifier: student.email,
      studentId: student.studentId,
      password: plainPassword,
    },
  });
});

const bulkImportStudentsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { csvData, collegeId } = req.body;
  const superAdminId = req.superAdmin.id;

  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Import target college is inactive or missing");
  }

  const job = await db.reportJob.create({
    data: {
      type: "STUDENT_IMPORT",
      status: "QUEUED",
      collegeId,
      filters: {
        startedAt: new Date().toISOString(),
        initiatedBySuperAdminId: superAdminId,
      },
    },
  });

  setTimeout(() => {
    processBulkImportJob({
      jobId: job.id,
      collegeId,
      superAdminId,
      csvData,
    });
  }, 0);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: "Bulk import queued",
  });
});

const getStudentImportJobGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { jobId } = req.params;

  const job = await db.reportJob.findFirst({
    where: {
      id: jobId,
      type: "STUDENT_IMPORT",
    },
  });

  if (!job || String(job.filters?.initiatedBySuperAdminId || "") !== String(req.superAdmin.id)) {
    throw new ApiError(404, "Import job not found");
  }

  res.status(200).json({
    jobId: job.id,
    status: String(job.status || "QUEUED").toLowerCase(),
    result: job.filters?.result || null,
    error: job.filters?.error || null,
  });
});

const updateStudentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { studentId } = req.params;
  const { fullName, email, enrollNumber, collegeId, departmentId, batchId, batchIds } = req.body;

  const existing = await db.student.findUnique({ where: { id: studentId } });
  if (!existing) {
    throw new ApiError(404, "Student not found");
  }

  if (email && email !== existing.email) {
    const duplicate = await db.student.findFirst({
      where: { collegeId: collegeId || existing.collegeId, email },
    });
    if (duplicate) {
      throw new ApiError(409, "Student with this email already exists");
    }
  }

  const updateData = {
    ...(fullName && { fullName }),
    ...(email && { email }),
    ...(enrollNumber && { enrollNumber }),
    ...(collegeId && { collegeId }),
    ...(departmentId && { departmentId }),
  };

  // Handle batch assignment (add to array if single batchId provided, or replace if batchIds array provided)
  if (batchId !== undefined) {
    const currentBatchIds = Array.isArray(existing.batchIds) ? existing.batchIds : [];
    const newBatchIds = [...new Set([...currentBatchIds, batchId])]; // Add to array, avoid duplicates
    updateData.batchIds = newBatchIds;
  } else if (batchIds !== undefined) {
    updateData.batchIds = Array.isArray(batchIds) ? batchIds : [];
  }

  const student = await db.student.update({
    where: { id: studentId },
    data: updateData,
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_STUDENT",
    targetType: "STUDENT",
    targetId: student.id,
    collegeId: student.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: student,
  });

  res.status(200).json(student);
});

const deleteStudentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { studentId } = req.params;
  const existing = await db.student.findUnique({ where: { id: studentId } });

  if (!existing) {
    throw new ApiError(404, "Student not found");
  }

  const expectedConfirmation = `DELETE ${existing.studentId || existing.id}`;
  if (req.body?.confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  await db.student.delete({ where: { id: studentId } });

  await createAuditLog({
    action: "SUPER_ADMIN_DELETE_STUDENT",
    targetType: "STUDENT",
    targetId: existing.id,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: null,
  });

  res.status(200).json({ id: studentId });
});

module.exports = {
  getStudentsGlobal,
  toggleStudentStatus,
  createStudentGlobal,
  bulkImportStudentsGlobal,
  getStudentImportJobGlobal,
  updateStudentGlobal,
  deleteStudentGlobal,
};
