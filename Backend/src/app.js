const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const compression = require("compression");

const env = require("./config/env");

// Allow k6/test runs to disable rate limiting without altering route wiring.
// Set RATE_LIMIT_DISABLED=true (or 1) in environment.
const isRateLimitDisabled =
  String(process.env.RATE_LIMIT_DISABLED || "").toLowerCase() === "true" ||
  String(process.env.RATE_LIMIT_DISABLED || "") === "1";

const { getRedisHealthSnapshot } = require("./config/redis");
const studentAuthRoutes = require("./routes/Students/auth.routes");
const studentDashboardRoutes = require("./routes/Students/dashboard.routes");
const studentTestsRoutes = require("./routes/Students/tests.routes");
const studentTestsCompatRoutes = require("./routes/Students/tests-compat.routes");
const studentEventsRoutes = require("./routes/Students/events.routes");
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
const superAdminSettingsRoutes = require("./routes/SuperAdmin/settings.routes");
const superAdminHealthRoutes = require("./routes/SuperAdmin/health.routes");
const superAdminQuestionBankRoutes = require("./routes/SuperAdmin/question-bank.routes");
const superAdminSubjectsRoutes = require("./routes/SuperAdmin/subjects.routes");
const { recordApiMetric } = require("./services/api-metrics.service");
const { createRateLimiter, authKeyByIp } = require("./middleware/rate-limit");
const { createResponseCache, createResponseCacheInvalidationHook } = require("./middleware/response-cache");
const { notFound, errorHandler } = require("./middleware/error-handler");
const { setupCompleteValidationSystem } = require("./config/validation-integration.setup");
const { getDb } = require("./utils/db");

const app = express();
app.set("trust proxy", 1);

const authStrictLimiter = isRateLimitDisabled
  ? createRateLimiter({ scope: "noop", windowMs: 1, max: 999999999, skip: () => true })
  : createRateLimiter({
      scope: "auth-login",
      routeLabel: "/api/*/auth/login",
      windowMs: env.rateLimit.authLoginWindowMs,
      max: env.rateLimit.authLoginMax,
      keySelector: authKeyByIp,
      failOpen: false,
      message: "Too many login attempts. Try again in a few minutes.",
    });


const authRefreshLimiter = isRateLimitDisabled
  ? createRateLimiter({
      scope: "noop",
      windowMs: 1,
      max: 999999999,
      skip: () => true,
    })
  : createRateLimiter({
      scope: "auth-refresh",
      routeLabel: "/api/*/auth/refresh",
      windowMs: env.rateLimit.authRefreshWindowMs,
      max: env.rateLimit.authRefreshMax,
      keySelector: authKeyByIp,
      failOpen: false,
      message: "Too many token refresh attempts. Please retry shortly.",
    });



const generalApiLimiter = isRateLimitDisabled
  ? createRateLimiter({
      scope: "noop",
      windowMs: 1,
      max: 999999999,
      skip: () => true,
    })
  : createRateLimiter({
      scope: "api-general",
      routeLabel: "/api/*",
      windowMs: env.rateLimit.generalApiWindowMs,
      max: env.rateLimit.generalApiMax,
      skip: (req) => req.path === "/health",
      message: "Too many requests. Please slow down and try again.",
    });



const adminReportsCache = createResponseCache({
  scope: "admin-reports",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.adminReportsTtlSeconds,
  tagsBuilder: (req) => [
    "admin-reports:all",
    req.admin?.collegeId ? `admin-reports:college:${req.admin.collegeId}` : null,
  ],
});

const superAnalyticsCache = createResponseCache({
  scope: "super-analytics",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.superAnalyticsTtlSeconds,
  tagsBuilder: () => ["super-analytics:all"],
});

const studentDashboardCache = createResponseCache({
  scope: "student-dashboard",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.studentDashboardTtlSeconds,
  tagsBuilder: (req) => [
    "student-dashboard:all",
    req.user?.id ? `student-dashboard:user:${req.user.id}` : null,
    req.user?.collegeId ? `student-dashboard:college:${req.user.collegeId}` : null,
  ],
});

const studentTestsCache = createResponseCache({
  scope: "student-tests",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.studentTestsTtlSeconds,
  tagsBuilder: (req) => [
    "student-tests:all",
    req.user?.id ? `student-tests:user:${req.user.id}` : null,
    req.user?.collegeId ? `student-tests:college:${req.user.collegeId}` : null,
  ],
});

const adminDashboardCache = createResponseCache({
  scope: "admin-dashboard",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.adminDashboardTtlSeconds,
  tagsBuilder: (req) => [
    "admin-dashboard:all",
    req.admin?.collegeId ? `admin-dashboard:college:${req.admin.collegeId}` : null,
  ],
});

const superDashboardCache = createResponseCache({
  scope: "super-dashboard",
  enabled: env.responseCache.enabled,
  ttlSeconds: env.responseCache.superDashboardTtlSeconds,
  tagsBuilder: () => ["super-dashboard:all"],
});

// Cache system health checks for 15s — prevents redundant DB/Redis/disk
// probes when multiple super admins have the dashboard open.
const systemHealthCache = createResponseCache({
  scope: "system-health",
  enabled: env.responseCache.enabled,
  ttlSeconds: 15,
  tagsBuilder: () => ["system-health:all"],
});

const allowedOrigins = env.frontendOrigins || [env.frontendOrigin].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(compression());
app.use(morgan("dev"));
app.use(express.json({ limit: env.requestBodyLimit }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(createResponseCacheInvalidationHook());

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

app.use("/api", generalApiLimiter);

app.use("/api/auth/login", authStrictLimiter);
app.use("/api/admin/auth/login", authStrictLimiter);
app.use("/api/super-admin/auth/login", authStrictLimiter);
app.use("/api/superadmin/auth/login", authStrictLimiter);

app.use("/api/auth/refresh", authRefreshLimiter);
app.use("/api/admin/auth/refresh", authRefreshLimiter);
app.use("/api/super-admin/auth/refresh", authRefreshLimiter);
app.use("/api/superadmin/auth/refresh", authRefreshLimiter);

app.use("/api/admin/reports/summary", adminReportsCache);
app.use("/api/admin/reports/charts", adminReportsCache);
app.use("/api/admin/reports/table", adminReportsCache);
app.use("/api/admin/reports/analytics", adminReportsCache);
app.use("/api/admin/reports/student/:studentId", adminReportsCache);
app.use("/api/super-admin/analytics", superAnalyticsCache);
app.use("/api/superadmin/analytics", superAnalyticsCache);
app.use("/api/dashboard/summary", studentDashboardCache);
app.use("/api/tests/ongoing", studentTestsCache);
app.use("/api/tests/upcoming", studentTestsCache);
app.use("/api/admin/dashboard/summary", adminDashboardCache);
app.use("/api/super-admin/dashboard/summary", superDashboardCache);
app.use("/api/superadmin/dashboard/summary", superDashboardCache);
app.use("/api/super-admin/system/health", systemHealthCache);
app.use("/api/superadmin/system/health", systemHealthCache);

app.use("/api/auth", studentAuthRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/super-admin/auth", superAdminAuthRoutes);
app.use("/api/superadmin/auth", superAdminAuthRoutes);

app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }

  if (
    req.path.startsWith("/api/tests/") ||
    req.path.startsWith("/api/attempts/") ||
    req.path.startsWith("/api/results/") ||
    req.path.startsWith("/api/submission/")
  ) {
    res.setHeader("Cache-Control", "no-store");
    return next();
  }

  const cacheablePrefixes = [
    "/api/dashboard",
    "/api/leaderboard",
    "/api/events",
    "/api/reports",
    "/api/admin/dashboard",
    "/api/admin/reports",
    "/api/super-admin/dashboard",
    "/api/super-admin/analytics",
    "/api/superadmin/dashboard",
    "/api/superadmin/analytics",
  ];

  if (cacheablePrefixes.some((prefix) => req.path.startsWith(prefix))) {
    res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
  }

  return next();
});

app.get("/api/health", async (_req, res) => {
  const checks = {};
  try {
    const database = await getDb();
    await database.college.count();
    checks.mongodb = "ok";
  } catch {
    checks.mongodb = "down";
  }

  const redisHealth = await getRedisHealthSnapshot();
  checks.redis = redisHealth.status;

  const healthy = checks.mongodb === "ok" && checks.redis !== "down";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks,
    redis: {
      configured: redisHealth.configured,
      available: redisHealth.available,
      latencyMs: redisHealth.latencyMs,
      error: redisHealth.error,
    },
    uptime: Math.floor(process.uptime()),
  });
});

app.use("/api/dashboard", studentDashboardRoutes);
app.use("/api/tests", studentTestsRoutes);
app.use("/api", studentTestsCompatRoutes);
app.use("/api/events", studentEventsRoutes);
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
  
app.use("/api/super-admin/settings", superAdminSettingsRoutes);
app.use("/api/super-admin/system", superAdminHealthRoutes);
app.use("/api/super-admin/question-bank", superAdminQuestionBankRoutes);
app.use("/api/super-admin/questions", superAdminQuestionBankRoutes);
app.use("/api/super-admin/subjects", superAdminSubjectsRoutes);

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
 
app.use("/api/superadmin/settings", superAdminSettingsRoutes);
app.use("/api/superadmin/system", superAdminHealthRoutes);
app.use("/api/superadmin/question-bank", superAdminQuestionBankRoutes);
app.use("/api/superadmin/questions", superAdminQuestionBankRoutes);
app.use("/api/superadmin/subjects", superAdminSubjectsRoutes);

setupCompleteValidationSystem(app);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
