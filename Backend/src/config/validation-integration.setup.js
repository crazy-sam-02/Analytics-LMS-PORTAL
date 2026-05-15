/**
 * Validation Integration Setup
 * 
 * Shows how to integrate validation services, monitoring routes, and alerts
 * into your Express application.
 * 
 * Add these to your main server.js or app.js file.
 */

// ============================================================================
// 1. Import Validation Routes and Services
// ============================================================================

const monitoringRoutes = require("../routes/SuperAdmin/monitoring.routes");
const { startAlertMonitoring } = require("../services/alert-monitoring.service");
const express = require("express");

// ============================================================================
// 2. Register Monitoring Routes (in your Express app setup)
// ============================================================================

/**
 * Example: In your app.js or server.js
 */
function setupValidationMonitoring(app) {
  // Register monitoring endpoints
  app.use("/api/super-admin", monitoringRoutes);

  console.log("✓ Validation monitoring routes registered");
  console.log("  Available endpoints:");
  console.log("  - GET /api/super-admin/metrics");
  console.log("  - GET /api/super-admin/metrics/failure-rate");
  console.log("  - GET /api/super-admin/metrics/anomalies");
  console.log("  - GET /api/super-admin/metrics/export");
  console.log("  - GET /api/super-admin/metrics/health");
  console.log("  - GET /api/super-admin/metrics/summary");
}

// ============================================================================
// 3. Setup Production Alerts
// ============================================================================

/**
 * Alert configuration - customize per environment
 */
const alertConfig = {
  // Slack configuration
  slackWebhook: process.env.SLACK_WEBHOOK_URL || null,

  // Email configuration
  emailService: null, // Set to your email service instance
  alertEmails: (process.env.ALERT_EMAILS || "").split(",").filter(Boolean),

  // PagerDuty configuration
  pagerdutyKey: process.env.PAGERDUTY_KEY || null,
};

/**
 * Start alert monitoring
 */
let alertMonitoringInterval = null;

function startAlertMonitoringService(interval = 60000) {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_ALERTS === "true") {
    alertMonitoringInterval = startAlertMonitoring(alertConfig, interval);
    console.log(`✓ Alert monitoring started (check every ${interval}ms)`);
  }
}

/**
 * Stop alert monitoring (for graceful shutdown)
 */
function stopAlertMonitoringService() {
  if (alertMonitoringInterval) {
    require("./services/alert-monitoring.service").stopAlertMonitoring(alertMonitoringInterval);
    console.log("✓ Alert monitoring stopped");
  }
}

// ============================================================================
// 4. Replace Existing Controllers (Migration Guide)
// ============================================================================

/**
 * How to migrate existing controllers to use validation services:
 * 
 * OLD (before):
 * const studentController = require("./controllers/Admin/students.controller");
 * 
 * NEW (after):
 * const studentController = require("./controllers/Admin/students-with-validation.controller");
 * 
 * Then update your routes to use the new handler names:
 * 
 * OLD routes:
 * router.post("/create", studentController.createStudent);
 * router.post("/bulk", studentController.bulkImportStudents);
 * 
 * NEW routes:
 * router.post("/create", studentController.createStudentHandler);
 * router.post("/bulk", studentController.bulkImportStudentsHandler);
 */

const validationControllers = {
  student: require("../controllers/Admin/students-with-validation.controller"),
  admin: require("../controllers/Admin/auth-with-validation.controller"),
  batch: require("../controllers/Admin/batches-with-validation.controller"),
  department: require("../controllers/Admin/departments-with-validation.controller"),
  submission: require("../controllers/Students/submission-with-validation.controller"),
};

// ============================================================================
// 5. Example: Wired Routes Setup
// ============================================================================

/**
 * Example route setup with validation integration
 */
function setupValidationRoutes(app, router) {
  const { student, admin, batch, department, submission } = validationControllers;

  // Admin routes
  router.post("/admin/students", student.createStudentHandler);
  router.post("/admin/students/bulk", student.bulkImportStudentsHandler);
  router.put("/admin/students/:studentId", student.updateStudentHandler);
  router.patch("/admin/students/:studentId/status", student.toggleStudentStatusHandler);
  router.get("/admin/students/metrics", student.getStudentMetrics);

  router.post("/admin/auth/create", admin.createAdminHandler);
  router.put("/admin/auth/:adminId", admin.updateAdminHandler);
  router.post("/admin/auth/:adminId/permissions", admin.assignPermissionsHandler);
  router.patch("/admin/auth/:adminId/status", admin.toggleAdminStatusHandler);
  router.get("/admin/auth/metrics", admin.getAdminMetrics);

  router.post("/admin/batches", batch.createBatchHandler);
  router.put("/admin/batches/:batchId", batch.updateBatchHandler);
  router.post("/admin/batches/bulk", batch.bulkCreateBatchesHandler);
  router.patch("/admin/batches/:batchId/status", batch.toggleBatchStatusHandler);
  router.get("/admin/batches/metrics", batch.getBatchMetrics);

  router.post("/admin/departments", department.createDepartmentHandler);
  router.put("/admin/departments/:departmentId", department.updateDepartmentHandler);
  router.post("/admin/departments/:departmentId/head", department.assignDepartmentHeadHandler);
  router.delete("/admin/departments/:departmentId/head", department.removeDepartmentHeadHandler);
  router.patch("/admin/departments/:departmentId/status", department.toggleDepartmentStatusHandler);
  router.get("/admin/departments/metrics", department.getDepartmentMetrics);

  // Student routes
  router.post("/students/submission/start", submission.startSubmission);
  router.post("/students/submission/:submissionId/answer", submission.saveAnswerHandler);
  router.post("/students/submission/:submissionId/answers/bulk", submission.bulkSaveAnswersHandler);
  router.post("/students/submission/:submissionId/submit", submission.submitTest);
  router.patch("/students/submission/:submissionId/answer/:answerId/review", submission.markAnswerForReviewHandler);
  router.post("/students/submission/:submissionId/violation", submission.recordProctoringViolation);
  router.get("/students/submission/metrics", submission.getSubmissionMetrics);

  console.log("✓ Validation routes registered");
}

// ============================================================================
// 6. Environment Variables Required
// ============================================================================

/**
 * Add to your .env file:
 * 
 * # Validation Monitoring
 * ENABLE_ALERTS=true
 * ALERT_CHECK_INTERVAL=60000
 * 
 * # Slack Integration
 * SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
 * 
 * # Email Integration
 * ALERT_EMAILS=admin@college.edu,ops@college.edu
 * 
 * # PagerDuty Integration
 * PAGERDUTY_KEY=your-pagerduty-routing-key
 */

// ============================================================================
// 7. Main App Setup Example
// ============================================================================

/**
 * Example usage in your app.js or server.js
 */
function setupCompleteValidationSystem(app) {
  // 1. Setup monitoring routes
  setupValidationMonitoring(app);

  // 2. Setup validation routes (after auth middleware)
  const router = express.Router();
  setupValidationRoutes(app, router);
  app.use("/api", router);

  // 3. Start alert monitoring
  startAlertMonitoringService(parseInt(process.env.ALERT_CHECK_INTERVAL || "60000"));

  // 4. Setup graceful shutdown
  process.on("SIGTERM", () => {
    console.log("SIGTERM received, stopping alert monitoring...");
    stopAlertMonitoringService();
  });

  process.on("SIGINT", () => {
    console.log("SIGINT received, stopping alert monitoring...");
    stopAlertMonitoringService();
    process.exit(0);
  });

  console.log("\n✓ Complete validation system initialized");
  console.log("  - Monitoring routes active");
  console.log("  - Validation services integrated");
  console.log("  - Alert monitoring started\n");
}

// ============================================================================
// 8. Testing Monitoring Endpoints
// ============================================================================

/**
 * Test the monitoring endpoints:
 * 
 * Get current metrics:
 * curl http://localhost:3000/api/super-admin/metrics
 * 
 * Get failure rate for specific model:
 * curl "http://localhost:3000/api/super-admin/metrics/failure-rate?model=UserValidation"
 * 
 * Check for anomalies:
 * curl http://localhost:3000/api/super-admin/metrics/anomalies
 * 
 * Get Prometheus metrics:
 * curl http://localhost:3000/api/super-admin/metrics/export
 * 
 * Quick health check:
 * curl http://localhost:3000/api/super-admin/metrics/health
 * 
 * Get concise summary:
 * curl http://localhost:3000/api/super-admin/metrics/summary
 */

// ============================================================================
// 9. Troubleshooting
// ============================================================================

/**
 * Common issues and solutions:
 * 
 * 1. Alerts not triggering:
 *    - Check SLACK_WEBHOOK_URL is set
 *    - Ensure NODE_ENV is 'production' or ENABLE_ALERTS=true
 *    - Check /api/super-admin/metrics/anomalies endpoint
 * 
 * 2. High validation latency:
 *    - Check /api/super-admin/metrics for latency metrics
 *    - Look for slow models in anomalies
 *    - Consider adding indexes to MongoDB
 * 
 * 3. High failure rate:
 *    - Check /api/super-admin/metrics/failure-rate
 *    - Review recent errors in failure details
 *    - Verify data meets schema requirements
 * 
 * 4. Controllers not found:
 *    - Verify file paths match your directory structure
 *    - Ensure files are in src/controllers/ with correct names
 *    - Check imports use -with-validation suffix
 */

module.exports = {
  setupValidationMonitoring,
  setupValidationRoutes,
  startAlertMonitoringService,
  stopAlertMonitoringService,
  setupCompleteValidationSystem,
  validationControllers,
  alertConfig,
};
