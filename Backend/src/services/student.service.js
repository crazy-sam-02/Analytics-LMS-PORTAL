const models = require("../models");
const bcrypt = require("bcrypt");
const { validateDocument, validateDocuments } = require("./model-validation.service");
const { UserValidation } = require("../models/validation");
const { ApiError } = require("../utils/http");

/**
 * Create a single student with validation
 *
 * Pattern:
 *   1. Validate using Mongoose schema
 *   2. Hash password
 *   3. Persist using modelClient
 *   4. Audit (optional)
 */
async function createStudent(payload, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;
  // Verify college exists
  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college) {
    throw new ApiError(422, "College not found", { collegeId }, "COLLEGE_NOT_FOUND");
  }

  // Validate student using Mongoose schema
  const validated = await validateDocument(
    UserValidation,
    {
      fullName: payload.fullName,
      email: (payload.email || "").toLowerCase(),
      role: "STUDENT",
      collegeId,
      departmentId: payload.departmentId || null,
      batchId: payload.batchId || null,
      isActive: payload.isActive !== false,
    },
    "Student creation"
  );

  // Hash password if provided
  const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : null;

  // Persist using modelClient
  const student = await db.student.create({
    data: {
      ...validated,
      enrollmentNumber: payload.enrollmentNumber || `STD-${Date.now()}`,
      passwordHash,
      // Additional fields not in validation schema
      phoneNumber: payload.phoneNumber || null,
      preferences: payload.preferences || {},
    },
    include: {
      college: true,
      department: true,
    },
  });

  // Audit
  await db.auditLog.create({
    data: {
      action: "STUDENT_CREATED",
      entityType: "student",
      entityId: student.id,
      userId: adminId,
      collegeId,
      metadata: {
        fullName: validated.fullName,
        email: validated.email,
        enrollmentNumber: student.enrollmentNumber,
      },
    },
  });

  return student;
}

/**
 * Update student with validation
 */
async function updateStudent(studentId, payload, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.student.findUnique({ where: { id: studentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Student not found or access denied");
  }

  // Validate merged data
  const validated = await validateDocument(
    UserValidation,
    {
      fullName: payload.fullName || existing.fullName,
      email: payload.email ? (payload.email || "").toLowerCase() : existing.email,
      role: "STUDENT",
      collegeId,
      departmentId: payload.departmentId !== undefined ? payload.departmentId : existing.departmentId,
      batchId: payload.batchId !== undefined ? payload.batchId : existing.batchId,
      isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
    },
    "Student update"
  );

  // Persist
  const updated = await db.student.update({
    where: { id: studentId },
    data: validated,
  });

  await db.auditLog.create({
    data: {
      action: "STUDENT_UPDATED",
      entityType: "student",
      entityId: studentId,
      userId: adminId,
      collegeId,
      metadata: { changes: Object.keys(payload) },
    },
  });

  return updated;
}

/**
 * Bulk import students with validation
 *
 * Validates each row, then bulk-creates them in a transaction
 */
async function bulkImportStudents(rows, collegeId, adminId) {
  const m = await models.init();
  const db = m.dbClient;
  const college = await db.college.findUnique({ where: { id: collegeId } });
  if (!college) {
    throw new ApiError(422, "College not found");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "No students provided", { count: rows?.length });
  }

  // Validate all rows
  const validatedRows = await validateDocuments(
    UserValidation,
    rows.map((row) => ({
      fullName: row.fullName,
      email: (row.email || "").toLowerCase(),
      role: "STUDENT",
      collegeId,
      departmentId: row.departmentId || null,
      batchId: row.batchId || null,
      isActive: true,
    })),
    "Bulk student import"
  );

  // Bulk insert in transaction
  const result = await db.$transaction(async (tx) => {
    // Hash passwords if provided
    const studentsData = validatedRows.map((validated, index) => {
      const password = rows[index].password ? bcrypt.hashSync(rows[index].password, 10) : null;
      return {
        ...validated,
        enrollmentNumber: rows[index].enrollmentNumber || `STD-${Date.now()}-${index}`,
        passwordHash: password,
        phoneNumber: rows[index].phoneNumber || null,
        preferences: {},
      };
    });

    // Insert all students
    const inserted = await tx.student.createMany({
      data: studentsData,
    });

    // Audit
    await tx.auditLog.create({
      data: {
        action: "STUDENTS_BULK_IMPORTED",
        entityType: "student",
        userId: adminId,
        collegeId,
        metadata: {
          count: inserted.count,
          emailDomain: rows[0]?.email?.split("@")[1] || "unknown",
        },
      },
    });

    return inserted;
  });

  return result;
}

/**
 * Activate/deactivate student
 */
async function toggleStudentStatus(studentId, collegeId, adminId, isActive) {
  const m = await models.init();
  const db = m.dbClient;
  const existing = await db.student.findUnique({ where: { id: studentId } });

  if (!existing || existing.collegeId !== collegeId) {
    throw new ApiError(403, "Student not found");
  }

  // Simple validation for status change
  const validated = await validateDocument(
    UserValidation,
    {
      ...existing,
      isActive,
    },
    "Student status toggle"
  );

  const updated = await db.student.update({
    where: { id: studentId },
    data: { isActive: validated.isActive },
  });

  await db.auditLog.create({
    data: {
      action: isActive ? "STUDENT_ACTIVATED" : "STUDENT_DEACTIVATED",
      entityType: "student",
      entityId: studentId,
      userId: adminId,
      collegeId,
    },
  });

  return updated;
}

module.exports = {
  createStudent,
  updateStudent,
  bulkImportStudents,
  toggleStudentStatus,
};
