const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const env = require("./config/env");
const studentAuthRoutes = require("./routes/Students/auth.routes");
const studentDashboardRoutes = require("./routes/Students/dashboard.routes");
const studentTestsRoutes = require("./routes/Students/tests.routes");
const studentTestsCompatRoutes = require("./routes/Students/tests-compat.routes");
const studentEventsRoutes = require("./routes/Students/events.routes");
const studentNotificationsRoutes = require("./routes/Students/notifications.routes");
const studentReportsRoutes = require("./routes/Students/reports.routes");
const studentLeaderboardRoutes = require("./routes/Students/leaderboard.routes");
const studentProfileRoutes = require("./routes/Students/profile.routes");
const studentMeRoutes = require("./routes/Students/me.routes");
const adminAuthRoutes = require("./routes/Admin/auth.routes");
const adminDashboardRoutes = require("./routes/Admin/dashboard.routes");
const adminTestsRoutes = require("./routes/Admin/tests.routes");
const adminQuestionBankRoutes = require("./routes/Admin/question-bank.routes");
const adminSubjectsRoutes = require("./routes/Admin/subjects.routes");
const adminStudentsRoutes = require("./routes/Admin/students.routes");
const adminDepartmentsRoutes = require("./routes/Admin/departments.routes");
const adminBatchesRoutes = require("./routes/Admin/batches.routes");
const adminEventsRoutes = require("./routes/Admin/events.routes");
const adminReportsRoutes = require("./routes/Admin/reports.routes");
const adminJobsRoutes = require("./routes/Admin/jobs.routes");
const adminSearchRoutes = require("./routes/Admin/search.routes");
const adminSettingsRoutes = require("./routes/Admin/settings.routes");
const adminAuditLogsRoutes = require("./routes/Admin/audit-logs.routes");
const superAdminAuthRoutes = require("./routes/SuperAdmin/auth.routes");
const superAdminDashboardRoutes = require("./routes/SuperAdmin/dashboard.routes");
const superAdminCollegesRoutes = require("./routes/SuperAdmin/colleges.routes");
const superAdminAdminsRoutes = require("./routes/SuperAdmin/admins.routes");
const superAdminStudentsRoutes = require("./routes/SuperAdmin/students.routes");
const superAdminTestsRoutes = require("./routes/SuperAdmin/tests.routes");
const superAdminBatchesRoutes = require("./routes/SuperAdmin/batches.routes");
const superAdminDepartmentsRoutes = require("./routes/SuperAdmin/departments.routes");
const superAdminEventsRoutes = require("./routes/SuperAdmin/events.routes");
const superAdminReportsRoutes = require("./routes/SuperAdmin/reports.routes");
const superAdminAnalyticsRoutes = require("./routes/SuperAdmin/analytics.routes");
const superAdminAuditLogsRoutes = require("./routes/SuperAdmin/audit-logs.routes");
const superAdminSettingsRoutes = require("./routes/SuperAdmin/settings.routes");
const superAdminHealthRoutes = require("./routes/SuperAdmin/health.routes");
const { recordApiMetric } = require("./services/api-metrics.service");
const { notFound, errorHandler } = require("./middleware/error-handler");

const app = express();

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    recordApiMetric({
      durationMs,
      statusCode: res.statusCode,
    });
  });
  next();
});

app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  studentAuthRoutes
);

app.use(
  "/api/admin/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  adminAuthRoutes
);

app.use(
  "/api/super-admin/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  superAdminAuthRoutes
);

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/dashboard", studentDashboardRoutes);
app.use("/api/tests", studentTestsRoutes);
app.use("/api", studentTestsCompatRoutes);
app.use("/api/events", studentEventsRoutes);
app.use("/api/notifications", studentNotificationsRoutes);
app.use("/api/reports", studentReportsRoutes);
app.use("/api/leaderboard", studentLeaderboardRoutes);
app.use("/api/profile", studentProfileRoutes);
app.use("/api/students/me", studentMeRoutes);

app.use("/api/admin/dashboard", adminDashboardRoutes);
app.use("/api/admin/tests", adminTestsRoutes);
app.use("/api/admin/question-bank", adminQuestionBankRoutes);
app.use("/api/admin/questions", adminQuestionBankRoutes);
app.use("/api/admin/subjects", adminSubjectsRoutes);
app.use("/api/admin/students", adminStudentsRoutes);
app.use("/api/admin/departments", adminDepartmentsRoutes);
app.use("/api/admin/batches", adminBatchesRoutes);
app.use("/api/admin/events", adminEventsRoutes);
app.use("/api/admin/reports", adminReportsRoutes);
app.use("/api/admin/jobs", adminJobsRoutes);
app.use("/api/admin/search", adminSearchRoutes);
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/audit-logs", adminAuditLogsRoutes);

app.use("/api/super-admin/dashboard", superAdminDashboardRoutes);
app.use("/api/super-admin/colleges", superAdminCollegesRoutes);
app.use("/api/super-admin/admins", superAdminAdminsRoutes);
app.use("/api/super-admin/students", superAdminStudentsRoutes);
app.use("/api/super-admin/tests", superAdminTestsRoutes);
app.use("/api/super-admin/batches", superAdminBatchesRoutes);
app.use("/api/super-admin/departments", superAdminDepartmentsRoutes);
app.use("/api/super-admin/events", superAdminEventsRoutes);
app.use("/api/super-admin/reports", superAdminReportsRoutes);
app.use("/api/super-admin/analytics", superAdminAnalyticsRoutes);
app.use("/api/super-admin/audit-logs", superAdminAuditLogsRoutes);
app.use("/api/super-admin/settings", superAdminSettingsRoutes);
app.use("/api/super-admin/system", superAdminHealthRoutes);

// Endpoint aliases for clients that use /superadmin instead of /super-admin.
app.use("/api/superadmin/auth", superAdminAuthRoutes);
app.use("/api/superadmin/dashboard", superAdminDashboardRoutes);
app.use("/api/superadmin/colleges", superAdminCollegesRoutes);
app.use("/api/superadmin/admins", superAdminAdminsRoutes);
app.use("/api/superadmin/students", superAdminStudentsRoutes);
app.use("/api/superadmin/tests", superAdminTestsRoutes);
app.use("/api/superadmin/batches", superAdminBatchesRoutes);
app.use("/api/superadmin/departments", superAdminDepartmentsRoutes);
app.use("/api/superadmin/events", superAdminEventsRoutes);
app.use("/api/superadmin/reports", superAdminReportsRoutes);
app.use("/api/superadmin/analytics", superAdminAnalyticsRoutes);
app.use("/api/superadmin/logs", superAdminAuditLogsRoutes);
app.use("/api/superadmin/settings", superAdminSettingsRoutes);
app.use("/api/superadmin/system", superAdminHealthRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
