const models = require("../../models");
const bcrypt = require("bcrypt");
const { redisClient, getRedisQueueConnection } = require("../../config/redis");
const { invalidateRefreshToken } = require("../../services/refresh-token-cache.service");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { getPagination } = require("../../utils/pagination");

let Queue = null;
let Worker = null;
try {
  ({ Queue, Worker } = require("bullmq"));
} catch (_error) {
  Queue = null;
  Worker = null;
}

let superStudentImportQueue = null;
const queueConnection = getRedisQueueConnection();

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

const resolveStudentId = (enrollNumber, fallbackStudentId = "") => String(enrollNumber || fallbackStudentId || "").trim();
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId;

const parseStudentYear = (value) => {
  const year = Number(String(value ?? "").trim());
  return Number.isInteger(year) && year >= 1 && year <= 4 ? year : null;
};

const normalizeBatchIds = (student, extraIds = []) => [...new Set([
  ...(Array.isArray(student?.batchIds) ? student.batchIds : []),
  student?.batchId,
  ...extraIds,
].filter(Boolean).map((id) => String(id)))];

const assertBatchCanAttachToStudent = (batch, studentCollegeId, studentDepartmentId) => {
  if (!batch || String(batch.collegeId || "") !== String(studentCollegeId || "")) {
    throw new ApiError(404, "Batch not found in selected college");
  }

  if (batch.isGlobal) {
    const scopedDepartmentIds = Array.isArray(batch.departmentIds) ? batch.departmentIds.map((id) => String(id)) : [];
    if (scopedDepartmentIds.length > 0 && !scopedDepartmentIds.includes(String(studentDepartmentId || ""))) {
      throw new ApiError(422, "Student department is not included in this global batch");
    }
    return;
  }

  if (String(batch.departmentId || "") !== String(studentDepartmentId || "")) {
    throw new ApiError(422, "Batch not found for selected department");
  }
};

const parseCsvRecords = (csvText) => {
  const records = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const text = String(csvText || "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some(Boolean)) {
        records.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) {
    records.push(row);
  }

  return records;
};

const parseCsv = (csvText) => {
  const rows = parseCsvRecords(csvText);

  if (rows.length === 0) return [];

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((values, rowIndex) => {
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
      const year = parseStudentYear(getRowValue(row, ["year", "studentYear", "student_year", "academicYear"]));
      const departmentLookup = getRowValue(row, ["departmentId", "department_id", "department", "departmentName"]);
      const batchLookup = getRowValue(row, ["batchId", "batch_id", "batch", "batchName"]);

      if (!fullName || !email || !departmentLookup || !enrollNumber || !year) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Missing required columns: fullName, email, enrollNumber, department, year" });
        continue;
      }

      const duplicateEmail = await db.student.findFirst({
        where: {
          collegeId,
          email,
        },
      });

      const studentId = resolveStudentId(enrollNumber, requestedStudentId);
      const duplicateStudentId = await db.student.findFirst({
        where: {
          collegeId,
          studentId,
        },
      });

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
      await db.student.create({
        data: {
          fullName,
          email,
          studentId,
          enrollNumber,
          passwordHash,
          collegeId,
          departmentId: department.id,
          year,
          batchId: batch?.id || null,
          batchIds: batch?.id ? [batch.id] : [],
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

const enqueueSuperStudentImportJob = async (payload) => {
  if (!superStudentImportQueue) {
    setTimeout(() => {
      processBulkImportJob(payload);
    }, 0);
    return;
  }

  try {
    await superStudentImportQueue.add("import", payload, { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    setTimeout(() => {
      processBulkImportJob(payload);
    }, 0);
  }
};

if (Queue && redisClient && queueConnection) {
  superStudentImportQueue = new Queue("super-student-import-jobs", {
    connection: queueConnection,
  });

  new Worker(
    "super-student-import-jobs",
    async (job) => {
      await processBulkImportJob(job.data);
    },
    {
      connection: queueConnection,
      concurrency: 2,
    }
  );
}

const getStudentsGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(req.query);
  const search = (req.query.search || "").trim();
  const { collegeId, departmentId, batchId, studentId, year } = req.query;

  const filters = [];
  if (batchId) {
    filters.push({ OR: [{ batchId }, { batchIds: { in: [batchId] } }] });
  }
  if (search) {
    filters.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { studentId: { contains: search, mode: "insensitive" } },
        { enrollNumber: { contains: search, mode: "insensitive" } },
        { enrollmentNumber: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (year) {
    filters.push({ year: Number(year) });
  }

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(studentId ? { id: studentId } : {}),
    ...(filters.length ? { AND: filters } : {}),
  };

  const [items, total] = await Promise.all([
    db.student.findMany({
      where,
      include: {
        college: true,
        department: true,
        batch: true,
      },
      orderBy: [{ year: "asc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
    db.student.count({ where }),
  ]);

  const data = items.map((student) => ({
    ...student,
    studentId: getStudentNumber(student),
  }));

  res.status(200).json({
    data,
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
    const expectedConfirmation = `BLOCK ${getStudentNumber(existing) || existing.id}`;
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

const resetStudentPassword = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const StudentRefreshToken = m.StudentRefreshToken;
  const { studentId } = req.params;

  const existing = await db.student.findUnique({ where: { id: studentId } });
  if (!existing) {
    throw new ApiError(404, "Student not found");
  }

  const resetPassword = createStudentPassword(existing.fullName, existing.enrollNumber || existing.enrollmentNumber || existing.studentId);
  const passwordHash = await bcrypt.hash(resetPassword, 10);

  await db.student.update({
    where: { id: studentId },
    data: { passwordHash },
  });

  const activeRefreshTokens = await StudentRefreshToken.findMany({
    where: {
      userId: studentId,
      revokedAt: null,
    },
  });

  await StudentRefreshToken.updateMany(
    { userId: studentId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  await Promise.all(activeRefreshTokens.map((record) => invalidateRefreshToken("student", record.token)));

  await createAuditLog({
    action: "SUPER_ADMIN_RESET_STUDENT_PASSWORD",
    targetType: "STUDENT",
    targetId: existing.id,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
  });

  res.status(200).json({
    message: "Student password reset",
    password: resetPassword,
  });
});

const createStudentGlobal = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const superAdminId = req.superAdmin.id;
  const { fullName, email, enrollNumber, year, collegeId, departmentId, department, batchId } = req.body;

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
      },
    });

    assertBatchCanAttachToStudent(batch, collegeId, departmentRecord.id);

    resolvedBatchId = batch.id;
  }

  const studentId = resolveStudentId(enrollNumber);
  const plainPassword = createStudentPassword(fullName, enrollNumber);
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const duplicateStudentId = await db.student.findFirst({ where: { collegeId, studentId } });
  if (duplicateStudentId) {
    throw new ApiError(409, "Student with this enroll number already exists");
  }

  const student = await db.student.create({
    data: {
      fullName,
      email,
      studentId,
      enrollNumber,
      passwordHash,
      collegeId,
      departmentId: departmentRecord.id,
      batchId: resolvedBatchId,
      batchIds: resolvedBatchId ? [resolvedBatchId] : [],
      year,
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

  await enqueueSuperStudentImportJob({
    jobId: job.id,
    collegeId,
    superAdminId,
    csvData,
  });

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
  const { fullName, email, enrollNumber, year, collegeId, departmentId, batchId, batchIds } = req.body;

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

  const nextCollegeId = collegeId || existing.collegeId;
  const nextDepartmentId = departmentId || existing.departmentId;
  const nextStudentId = enrollNumber ? String(enrollNumber).trim() : null;
  if (nextStudentId && nextStudentId !== existing.studentId) {
    const duplicateStudentId = await db.student.findFirst({
      where: { collegeId: nextCollegeId, studentId: nextStudentId },
    });
    if (duplicateStudentId) {
      throw new ApiError(409, "Student with this enroll number already exists");
    }
  }

  const updateData = {
    ...(fullName && { fullName }),
    ...(email && { email }),
    ...(enrollNumber && { enrollNumber, studentId: String(enrollNumber).trim() }),
    ...(year !== undefined ? { year } : {}),
    ...(collegeId && { collegeId: nextCollegeId }),
    ...(departmentId && { departmentId: nextDepartmentId }),
  };

  // Handle batch assignment (add to array if single batchId provided, or replace if batchIds array provided)
  if (batchId !== undefined) {
    const batch = await db.batch.findFirst({ where: { id: batchId, collegeId: nextCollegeId } });
    assertBatchCanAttachToStudent(batch, nextCollegeId, nextDepartmentId);
    const newBatchIds = normalizeBatchIds(existing, [batchId]);
    updateData.batchIds = newBatchIds;
    updateData.batchId = batchId;
    if (!batch.isGlobal) {
      updateData.departmentId = batch.departmentId;
    }
  } else if (batchIds !== undefined) {
    const nextBatchIds = [...new Set((Array.isArray(batchIds) ? batchIds : []).filter(Boolean).map((id) => String(id)))];
    if (nextBatchIds.length > 0) {
      const batches = await db.batch.findMany({ where: { id: { in: nextBatchIds }, collegeId: nextCollegeId } });
      if (batches.length !== nextBatchIds.length) {
        throw new ApiError(422, "One or more batches are not in the selected college");
      }
      batches.forEach((batch) => assertBatchCanAttachToStudent(batch, nextCollegeId, nextDepartmentId));
    }
    updateData.batchIds = nextBatchIds;
    updateData.batchId = nextBatchIds[0] || null;
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

  const expectedConfirmation = `DELETE ${getStudentNumber(existing) || existing.id}`;
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
  resetStudentPassword,
  createStudentGlobal,
  bulkImportStudentsGlobal,
  getStudentImportJobGlobal,
  updateStudentGlobal,
  deleteStudentGlobal,
};
