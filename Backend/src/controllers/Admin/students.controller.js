const prisma = require("../../config/db");
const bcrypt = require("bcrypt");
const { asyncHandler, ApiError } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");

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
  const seedDigits = String(seedValue || "").replace(/\D/g, "");
  const suffix = (seedDigits.slice(-4) || `${Date.now()}`.slice(-4)).padStart(4, "0");

  let index = 0;
  while (index < 500) {
    const candidate = index === 0 ? `STD-${suffix}` : `STD-${suffix}-${String(index).padStart(2, "0")}`;
    const exists = await prisma.student.findFirst({
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

const processBulkImportJob = async ({ jobId, collegeId, adminId, csvData }) => {
  const rows = parseCsv(csvData);
  const result = {
    created: 0,
    failed: 0,
    duplicates: 0,
    errors: [],
  };

  try {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: "PROCESSING",
      },
    });

    for (const row of rows) {
      const fullName = row.fullname || row.name || "";
      const email = row.email || "";
      const requestedStudentId = row.studentid || row.student_id || "";
      const enrollNumber = row.enrollnumber || row.enroll_number || requestedStudentId;
      const departmentName = row.department || row.departmentname || "";
      const batchName = row.batch || row.batchname || "";

      if (!fullName || !email || !departmentName || !enrollNumber) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Missing required columns" });
        continue;
      }

      const duplicateEmail = await prisma.student.findFirst({
        where: {
          collegeId,
          email,
        },
      });

      const duplicateStudentId = requestedStudentId
        ? await prisma.student.findFirst({
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

      const department = await prisma.department.findFirst({
        where: {
          collegeId,
          name: {
            equals: departmentName,
            mode: "insensitive",
          },
        },
      });

      if (!department) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Invalid department" });
        continue;
      }

      const batch = batchName
        ? await prisma.batch.findFirst({
            where: {
              collegeId,
              departmentId: department.id,
              name: {
                equals: batchName,
                mode: "insensitive",
              },
            },
          })
        : null;

      const generatedPassword = createStudentPassword(fullName, enrollNumber);
      const passwordHash = await bcrypt.hash(generatedPassword, 10);
      const studentId = requestedStudentId || await generateUniqueStudentId(collegeId, enrollNumber);

      await prisma.student.create({
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

    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        filters: {
          type: "STUDENT_IMPORT",
          result,
          completedAt: new Date().toISOString(),
        },
      },
    });

    await createAuditLog({
      action: "ADMIN_STUDENT_BULK_IMPORT_COMPLETED",
      targetType: "STUDENT_IMPORT",
      targetId: jobId,
      collegeId,
      adminId,
      afterState: result,
    });
  } catch (error) {
    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        filters: {
          type: "STUDENT_IMPORT",
          result,
          failedAt: new Date().toISOString(),
          error: error?.message || "Unknown failure",
        },
      },
    });
  }
};

const getStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);

  const where = {
    collegeId,
    ...(req.query.departmentId ? { departmentId: req.query.departmentId } : {}),
    ...(req.query.batchId ? { batchId: req.query.batchId } : {}),
    ...(req.query.search
      ? {
          OR: [
            { fullName: { contains: req.query.search, mode: "insensitive" } },
            { email: { contains: req.query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      include: {
        batch: true,
        department: true,
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.status(200).json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const createStudent = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { fullName, email, department, enrollNumber } = req.body;
  const generatedStudentId = await generateUniqueStudentId(collegeId, enrollNumber);

  const [duplicateEmail] = await Promise.all([
    prisma.student.findFirst({ where: { collegeId, email } }),
  ]);

  if (duplicateEmail) {
    throw new ApiError(409, "Student with this email already exists");
  }

  const departmentRecord = await prisma.department.findFirst({
    where: {
      collegeId,
      name: {
        equals: department,
        mode: "insensitive",
      },
    },
  });

  if (!departmentRecord) {
    throw new ApiError(404, "Department not found");
  }

  const plainPassword = createStudentPassword(fullName, enrollNumber);
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const student = await prisma.student.create({
    data: {
      fullName,
      email,
      studentId: generatedStudentId,
      passwordHash,
      collegeId,
      departmentId: departmentRecord.id,
    },
    include: {
      department: true,
      batch: true,
    },
  });

  await createAuditLog({
    action: "ADMIN_STUDENT_CREATED",
    targetType: "STUDENT",
    targetId: student.id,
    collegeId,
    adminId,
    afterState: {
      email: student.email,
      studentId: student.studentId,
      departmentId: student.departmentId,
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

const getStudentPerformance = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;

  const student = await prisma.student.findFirst({
    where: { id: studentId, collegeId },
    include: {
      submissions: {
        include: {
          test: {
            select: {
              title: true,
              subject: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  res.status(200).json(student);
});

const getStudentProfile = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;

  const student = await prisma.student.findFirst({
    where: { id: studentId, collegeId },
    include: {
      batch: true,
      department: true,
      _count: {
        select: {
          submissions: true,
        },
      },
    },
  });

  if (!student) {
    throw new ApiError(404, "Student not found");
  }

  res.status(200).json(student);
});

const assignStudentToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { studentId } = req.params;
  const { batchId } = req.body;

  const [batch, student] = await Promise.all([
    prisma.batch.findFirst({ where: { id: batchId, collegeId } }),
    prisma.student.findFirst({ where: { id: studentId, collegeId } }),
  ]);

  if (!batch || !student) {
    return res.status(404).json({ message: "Student or batch not found" });
  }

  const updated = await prisma.student.update({
    where: { id: studentId },
    data: {
      batchId,
      departmentId: batch.departmentId,
    },
  });

  await createAuditLog({
    action: "ADMIN_STUDENT_BATCH_ASSIGNED",
    targetType: "STUDENT",
    targetId: studentId,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      batchId,
      departmentId: batch.departmentId,
    },
  });

  res.status(200).json(updated);
});

const bulkImportStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { csvData } = req.body;

  const job = await prisma.reportJob.create({
    data: {
      type: "STUDENT_IMPORT",
      status: "QUEUED",
      collegeId,
      adminId: req.admin.id,
      filters: {
        startedAt: new Date().toISOString(),
      },
    },
  });

  // Execute async to keep API responsive for large files.
  setTimeout(() => {
    processBulkImportJob({
      jobId: job.id,
      collegeId,
      adminId: req.admin.id,
      csvData,
    });
  }, 0);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: "Bulk import queued",
  });
});

const getStudentImportJob = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { jobId } = req.params;

  const job = await prisma.reportJob.findFirst({
    where: {
      id: jobId,
      collegeId,
      type: "STUDENT_IMPORT",
    },
  });

  if (!job) {
    throw new ApiError(404, "Import job not found");
  }

  res.status(200).json({
    jobId: job.id,
    status: String(job.status || "QUEUED").toLowerCase(),
    result: job.filters?.result || null,
    error: job.filters?.error || null,
  });
});

module.exports = {
  getStudents,
  createStudent,
  getStudentPerformance,
  getStudentProfile,
  assignStudentToBatch,
  bulkImportStudents,
  getStudentImportJob,
};
