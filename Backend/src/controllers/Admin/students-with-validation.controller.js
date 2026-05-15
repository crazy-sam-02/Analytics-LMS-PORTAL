/**
 * Admin Students Controller with Validation Integration
 * 
 * This controller integrates student.service for all CRUD operations.
 * Usage: Replace existing controller imports with this one to enable validation.
 */

const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");
const {
  createStudent,
  updateStudent,
  bulkImportStudents: bulkImportStudentsService,
  toggleStudentStatus,
} = require("../../services/student.service");
const { getMetricsSnapshot } = require("../../services/validation-monitoring.service");

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

/**
 * Get all students with pagination and filters
 */
const getStudents = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
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
    db.student.count({ where }),
    db.student.findMany({
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

/**
 * Create single student with validation
 */
const createStudentHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;

  try {
    const student = await createStudent(
      {
        fullName: req.body.fullName,
        email: req.body.email,
        enrollmentNumber: req.body.enrollNumber,
        departmentId: req.body.departmentId,
        batchId: req.body.batchId,
      },
      collegeId,
      adminId
    );

    res.status(201).json({
      success: true,
      student,
      message: "Student created successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      // Validation error with details
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Bulk import students from CSV with validation
 */
const bulkImportStudentsHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;

  if (!req.body.csvData) {
    throw new ApiError(400, "CSV data is required");
  }

  const rows = parseCsv(req.body.csvData);
  if (rows.length === 0) {
    throw new ApiError(400, "No valid rows in CSV");
  }

  try {
    // Call the service with proper field mapping
    const result = await bulkImportStudentsService(
      rows.map((row) => ({
        fullName: row.fullname || row.name || "",
        email: row.email || "",
        enrollmentNumber: row.enrollnumber || row.enroll_number || "",
        departmentId: row.departmentid || "",
        batchId: row.batchid || null,
      })),
      collegeId,
      adminId
    );

    res.status(200).json({
      success: true,
      message: "Bulk import completed",
      result,
      metrics: await getMetricsSnapshot(), // Include validation metrics
    });
  } catch (error) {
    // Return validation errors with detailed context
    res.status(400).json({
      success: false,
      error: error.message,
      details: error.details,
      code: error.errorCode,
      metrics: await getMetricsSnapshot(),
    });
  }
});

/**
 * Update student with validation
 */
const updateStudentHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { studentId } = req.params;

  try {
    const student = await updateStudent(
      studentId,
      req.body,
      collegeId,
      adminId
    );

    res.status(200).json({
      success: true,
      student,
      message: "Student updated successfully",
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        error: error.message,
        details: error.details,
        code: error.errorCode,
      });
    }
    throw error;
  }
});

/**
 * Toggle student status (active/inactive)
 */
const toggleStudentStatusHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { studentId } = req.params;
  const { isActive } = req.body;

  try {
    const student = await toggleStudentStatus(
      studentId,
      collegeId,
      adminId,
      isActive
    );

    res.status(200).json({
      success: true,
      student,
      message: `Student ${isActive ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get validation metrics for student operations
 */
const getStudentMetrics = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const metrics = await getMetricsSnapshot();
  const studentMetrics = metrics.failures?.UserValidation || {};

  res.status(200).json({
    total_validations: metrics.summary.total,
    successful: metrics.summary.passed,
    failed: metrics.summary.failed,
    success_rate: metrics.summary.successRate,
    student_failures: {
      count: studentMetrics.count || 0,
      recent_errors: (studentMetrics.errors || []).slice(0, 5),
    },
    latency_ms: metrics.latency?.UserValidation || {},
  });
});

module.exports = {
  getStudents,
  createStudentHandler,
  bulkImportStudentsHandler,
  updateStudentHandler,
  toggleStudentStatusHandler,
  getStudentMetrics,
};
