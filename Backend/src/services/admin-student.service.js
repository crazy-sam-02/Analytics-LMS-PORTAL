const bcrypt = require("bcrypt");
const models = require("../models");
const { redisClient, getRedisQueueConnection } = require("../config/redis");
const { ApiError } = require("../utils/http");
const { createAuditLog } = require("./audit.service");
const { getPagination } = require("../utils/pagination");

let Queue = null;
let Worker = null;
try {
  ({ Queue, Worker } = require("bullmq"));
} catch (_error) {
  Queue = null;
  Worker = null;
}

let studentImportQueue = null;
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

const processBulkImportJob = async ({ jobId, collegeId, adminId, adminDepartmentId, csvData }, db) => {
  const rows = parseCsv(csvData);
  const result = { created: 0, failed: 0, duplicates: 0, errors: [] };

  try {
    await db.reportJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });

    for (const row of rows) {
      const fullName = row.fullname || row.name || "";
      const email = row.email || "";
      const requestedStudentId = row.studentid || row.student_id || "";
      const enrollNumber = row.enrollnumber || row.enroll_number || requestedStudentId;
      const year = parseStudentYear(row.year || row.studentyear || row.student_year || row.academicyear);
      const departmentName = row.department || row.departmentname || "";
      const batchName = row.batch || row.batchname || "";

      if (!fullName || !email || !departmentName || !enrollNumber || !year) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Missing required columns: fullName, email, enrollNumber, department, year" });
        continue;
      }

      const duplicateEmail = await db.student.findFirst({ where: { collegeId, email } });

      const studentId = resolveStudentId(enrollNumber, requestedStudentId);
      const duplicateStudentId = await db.student.findFirst({ where: { collegeId, studentId } });

      if (duplicateEmail || duplicateStudentId) {
        result.duplicates += 1;
        result.errors.push({ row: row.__row, reason: duplicateEmail ? "Duplicate email" : "Duplicate student id" });
        continue;
      }

      const department = await db.department.findFirst({ where: { collegeId, name: { equals: departmentName, mode: "insensitive" } } });
      if (!department) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Invalid department" });
        continue;
      }

      if (adminDepartmentId && String(department.id) !== String(adminDepartmentId)) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Department is outside the admin scope" });
        continue;
      }

      const batch = batchName
        ? await db.batch.findFirst({ where: { collegeId, departmentId: department.id, name: { equals: batchName, mode: "insensitive" } } })
        : null;

      const generatedPassword = createStudentPassword(fullName, enrollNumber);
      const passwordHash = await bcrypt.hash(generatedPassword, 10);
      const resolvedBatchId = batch?.id || null;
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
          batchId: resolvedBatchId,
          batchIds: resolvedBatchId ? [resolvedBatchId] : [],
        },
      });

      result.created += 1;
    }

    await db.reportJob.update({ where: { id: jobId }, data: { status: "COMPLETED", filters: { type: "STUDENT_IMPORT", result, completedAt: new Date().toISOString() } } });

    await createAuditLog({ action: "ADMIN_STUDENT_BULK_IMPORT_COMPLETED", targetType: "STUDENT_IMPORT", targetId: jobId, collegeId, adminId, afterState: result });
  } catch (error) {
    await db.reportJob.update({ where: { id: jobId }, data: { status: "FAILED", filters: { type: "STUDENT_IMPORT", result, failedAt: new Date().toISOString(), error: error?.message || "Unknown failure" } } });
  }
};

const enqueueStudentImportJob = async (payload, db) => {
  if (!studentImportQueue) {
    setTimeout(() => {
      processBulkImportJob(payload, db);
    }, 0);
    return;
  }

  try {
    await studentImportQueue.add("import", payload, { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: true, removeOnFail: false });
  } catch (_error) {
    setTimeout(() => {
      processBulkImportJob(payload, db);
    }, 0);
  }
};

if (Queue && redisClient && queueConnection) {
  studentImportQueue = new Queue("admin-student-import-jobs", {
    connection: queueConnection,
  });

  new Worker(
    "admin-student-import-jobs",
    async (job) => {
      const m = await models.init();
      await processBulkImportJob(job.data, m.dbClient);
    },
    {
      connection: queueConnection,
      concurrency: 2,
    }
  );
}

const listStudents = async (collegeId, opts = {}) => {
  const m = await models.init();
  const db = m.dbClient;
  const { page, limit, skip } = getPagination(opts);
  const year = opts.year !== undefined && opts.year !== "" ? Number(opts.year) : undefined;

  const where = {
    collegeId,
    ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
    ...(year !== undefined && Number.isFinite(year) ? { year } : {}),
  };

  const filters = [];
  if (opts.batchId) {
    filters.push({
      OR: [
        { batchIds: { in: [opts.batchId] } },
        { batchId: opts.batchId },
      ],
    });
  }

  if (opts.search) {
    filters.push({
      OR: [
        { fullName: { contains: opts.search, mode: "insensitive" } },
        { email: { contains: opts.search, mode: "insensitive" } },
        { studentId: { contains: opts.search, mode: "insensitive" } },
        { enrollNumber: { contains: opts.search, mode: "insensitive" } },
        { enrollmentNumber: { contains: opts.search, mode: "insensitive" } },
        { department: { name: { contains: opts.search, mode: "insensitive" } } },
      ],
    });
  }

  if (filters.length > 0) {
    where.AND = filters;
  }

  const [total, data] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      include: {
        batches: true,
        department: true,
        _count: { select: { submissions: true } },
      },
      orderBy: [{ year: "asc" }, { createdAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  const normalized = data.map((student) => {
    const mergedBatchIds = [...new Set([
      ...(Array.isArray(student.batchIds) ? student.batchIds : []),
      student.batchId,
    ].filter(Boolean).map((id) => String(id)))];

    return {
      ...student,
      studentId: getStudentNumber(student),
      batchIds: mergedBatchIds,
      batch: student.batch || (Array.isArray(student.batches) ? student.batches[0] : null),
    };
  });

  return { data: normalized, total, page, limit };
};

const createStudent = async (collegeId, adminId, payload) => {
  const m = await models.init();
  const db = m.dbClient;
  const { fullName, email, department, enrollNumber, year, batch: batchId } = payload;
  const studentId = resolveStudentId(enrollNumber);

  const [duplicateEmail, duplicateStudentId] = await Promise.all([
    db.student.findFirst({ where: { collegeId, email } }),
    db.student.findFirst({ where: { collegeId, studentId } }),
  ]);
  if (duplicateEmail) throw new ApiError(409, "Student with this email already exists");
  if (duplicateStudentId) throw new ApiError(409, "Student with this enroll number already exists");

  const departmentRecord = await db.department.findFirst({ where: { collegeId, name: { equals: department, mode: "insensitive" } } });
  if (!departmentRecord) throw new ApiError(404, "Department not found");

  const plainPassword = createStudentPassword(fullName, enrollNumber);
  const passwordHash = await bcrypt.hash(plainPassword, 10);

  let batchRecord = null;
  if (batchId) {
    batchRecord = await db.batch.findFirst({ where: { id: batchId, collegeId, departmentId: departmentRecord.id } });
    if (!batchRecord) throw new ApiError(404, "Batch not found in the selected department");
  }

  const resolvedBatchId = batchRecord?.id || null;
  const numericYear = Number(year);
  const resolvedYear = Number.isFinite(numericYear) ? numericYear : null;

  const student = await db.student.create({
    data: {
      fullName,
      email,
      studentId,
      enrollNumber,
      passwordHash,
      collegeId,
      departmentId: departmentRecord.id,
      year: resolvedYear,
      batchId: resolvedBatchId,
      batchIds: resolvedBatchId ? [resolvedBatchId] : [],
    },
    include: { department: true, batches: true },
  });

  await createAuditLog({ action: "ADMIN_STUDENT_CREATED", targetType: "STUDENT", targetId: student.id, collegeId, adminId, afterState: { email: student.email, studentId: student.studentId, departmentId: student.departmentId } });

  return {
    student: {
      ...student,
      batch: Array.isArray(student.batches) ? student.batches[0] : null,
    },
    credentials: { identifier: student.email, studentId: student.studentId, password: plainPassword },
  };
};

const getStudentPerformance = async (collegeId, studentId) => {
  const m = await models.init();
  const db = m.dbClient;
  const student = await db.student.findFirst({ where: { id: studentId, collegeId }, include: { submissions: { include: { test: { select: { title: true, subject: true } } }, orderBy: { createdAt: "desc" } } } });
  return student;
};

const getStudentProfile = async (collegeId, studentId) => {
  const m = await models.init();
  const db = m.dbClient;
  const student = await db.student.findFirst({
    where: { id: studentId, collegeId },
    include: { batches: true, department: true, _count: { select: { submissions: true } } },
  });
  if (!student) throw new ApiError(404, "Student not found");
  const mergedBatchIds = [...new Set([
    ...(Array.isArray(student.batchIds) ? student.batchIds : []),
    student.batchId,
  ].filter(Boolean).map((id) => String(id)))];
  return {
    ...student,
    studentId: getStudentNumber(student),
    batchIds: mergedBatchIds,
    batch: student.batch || (Array.isArray(student.batches) ? student.batches[0] : null),
  };
};

const assignStudentToBatch = async (collegeId, adminId, studentId, batchId) => {
  const m = await models.init();
  const db = m.dbClient;
  const [batch, student] = await Promise.all([db.batch.findFirst({ where: { id: batchId, collegeId } }), db.student.findFirst({ where: { id: studentId, collegeId } })]);
  if (!batch || !student) throw new ApiError(404, "Student or batch not found");

  const existingBatchIds = Array.isArray(student.batchIds) ? student.batchIds : [];
  const mergedBatchIds = [...new Set([
    ...existingBatchIds,
    student.batchId,
    batchId,
  ].filter(Boolean).map((id) => String(id)))];

  const updated = await db.student.update({
    where: { id: studentId },
    data: {
      batchIds: mergedBatchIds,
      batchId,
      ...(batch.isGlobal ? {} : { departmentId: batch.departmentId }),
    },
    include: { batches: true, department: true },
  });

  await createAuditLog({ action: "ADMIN_STUDENT_BATCH_ASSIGNED", targetType: "STUDENT", targetId: studentId, collegeId, adminId, afterState: { batchId, departmentId: batch.isGlobal ? student.departmentId : batch.departmentId, isGlobalBatch: Boolean(batch.isGlobal) } });

  return {
    ...updated,
    batch: updated.batch || (Array.isArray(updated.batches) ? updated.batches[0] : null),
  };
};

const bulkImportStudents = async (collegeId, adminId, csvData, adminDepartmentId = null) => {
  const m = await models.init();
  const db = m.dbClient;

  const job = await db.reportJob.create({ data: { type: "STUDENT_IMPORT", status: "QUEUED", collegeId, adminId, filters: { startedAt: new Date().toISOString() } } });

  await enqueueStudentImportJob({ jobId: job.id, collegeId, adminId, adminDepartmentId, csvData }, db);

  return { jobId: job.id, status: job.status };
};

const getStudentImportJob = async (collegeId, jobId) => {
  const m = await models.init();
  const db = m.dbClient;
  const job = await db.reportJob.findFirst({ where: { id: jobId, collegeId, type: "STUDENT_IMPORT" } });
  if (!job) throw new ApiError(404, "Import job not found");
  return { jobId: job.id, status: String(job.status || "QUEUED").toLowerCase(), result: job.filters?.result || null, error: job.filters?.error || null };
};

module.exports = {
  listStudents,
  createStudent,
  getStudentPerformance,
  getStudentProfile,
  assignStudentToBatch,
  bulkImportStudents,
  getStudentImportJob,
};
