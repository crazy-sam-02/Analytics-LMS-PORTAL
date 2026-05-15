/**
 * Admin Batches Controller with Validation Integration
 * 
 * Integrates batch.service for batch operations with validation.
 */

const models = require("../../models");
const { ApiError, asyncHandler } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");
const {
  createBatch,
  updateBatch,
  bulkCreateBatches: bulkCreateBatchesService,
  toggleBatchStatus,
} = require("../../services/batch.service");
const { getMetricsSnapshot } = require("../../services/validation-monitoring.service");

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

/**
 * Get all batches
 */
const getBatches = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;

  const batches = await db.batch.findMany({
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

/**
 * Get batch detail
 */
const getBatchDetail = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const { batchId } = req.params;

  const batch = await db.batch.findFirst({
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

/**
 * Create single batch with validation
 */
const createBatchHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;

  try {
    const batch = await createBatch(
      {
        name: req.body.name,
        departmentId: req.body.departmentId,
        capacity: req.body.capacity,
        academicYear: req.body.academicYear,
        section: req.body.section,
      },
      collegeId,
      adminId
    );

    res.status(201).json({
      success: true,
      batch,
      message: "Batch created successfully",
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
 * Update batch with validation
 */
const updateBatchHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { batchId } = req.params;

  try {
    const batch = await updateBatch(
      batchId,
      req.body,
      collegeId,
      adminId
    );

    res.status(200).json({
      success: true,
      batch,
      message: "Batch updated successfully",
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
 * Bulk create batches
 */
const bulkCreateBatchesHandler = asyncHandler(async (req, res) => {
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
    const result = await bulkCreateBatchesService(
      rows.map((row) => ({
        name: row.name || "",
        departmentId: row.departmentid || "",
        capacity: Number(row.capacity) || 100,
        academicYear: row.year || row.academicyear || "",
        section: row.section || "",
      })),
      collegeId,
      adminId
    );

    res.status(200).json({
      success: true,
      message: "Bulk batch creation completed",
      result,
      metrics: await getMetricsSnapshot(),
    });
  } catch (error) {
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
 * Toggle batch status
 */
const toggleBatchStatusHandler = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { batchId } = req.params;
  const { isActive } = req.body;

  try {
    const batch = await toggleBatchStatus(
      batchId,
      collegeId,
      adminId,
      isActive
    );

    res.status(200).json({
      success: true,
      batch,
      message: `Batch ${isActive ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    throw error;
  }
});

/**
 * Get batch validation metrics
 */
const getBatchMetrics = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const metrics = await getMetricsSnapshot();
  const batchMetrics = metrics.failures?.BatchValidation || {};

  res.status(200).json({
    total_validations: metrics.summary.total,
    successful: metrics.summary.passed,
    failed: metrics.summary.failed,
    success_rate: metrics.summary.successRate,
    batch_failures: {
      count: batchMetrics.count || 0,
      recent_errors: (batchMetrics.errors || []).slice(0, 5),
    },
    latency_ms: metrics.latency?.BatchValidation || {},
  });
});

module.exports = {
  getBatches,
  getBatchDetail,
  createBatchHandler,
  updateBatchHandler,
  bulkCreateBatchesHandler,
  toggleBatchStatusHandler,
  getBatchMetrics,
};
