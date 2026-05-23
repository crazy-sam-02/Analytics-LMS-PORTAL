const dotenv = require("dotenv");

dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required");
}

// JWT secrets are required in ALL environments to prevent accidental use of
// weak defaults. Generate strong secrets with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
  throw new Error(
    "JWT_ACCESS_SECRET must be set and at least 32 characters. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\""
  );
}

if (!jwtRefreshSecret || jwtRefreshSecret.length < 32) {
  throw new Error(
    "JWT_REFRESH_SECRET must be set and at least 32 characters. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64'))\""
  );
}

const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const frontendOrigins = parseOrigins(process.env.FRONTEND_ORIGIN || "http://localhost:5173");

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const toBoolean = (value, fallback) => {
  if (typeof value === "undefined") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const legacyExamWriteWindowMs = toPositiveInt(process.env.RATE_LIMIT_EXAM_WRITE_WINDOW_MS, 60 * 1000);
const legacyExamWriteMax = toPositiveInt(process.env.RATE_LIMIT_EXAM_WRITE_MAX, 100);

const rateLimit = {
  authLoginWindowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS, 15 * 60 * 1000),
  authLoginMax: toPositiveInt(process.env.RATE_LIMIT_AUTH_LOGIN_MAX, 15),
  authRefreshWindowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_REFRESH_WINDOW_MS, 5 * 60 * 1000),
  authRefreshMax: toPositiveInt(process.env.RATE_LIMIT_AUTH_REFRESH_MAX, 50),
  examWriteWindowMs: legacyExamWriteWindowMs,
  examWriteMax: legacyExamWriteMax,
  examAnswerWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_ANSWER_WINDOW_MS, legacyExamWriteWindowMs),
  examAnswerMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_ANSWER_MAX, legacyExamWriteMax),
  examHeartbeatWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_HEARTBEAT_WINDOW_MS, 60 * 1000),
  examHeartbeatMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_HEARTBEAT_MAX, 30),
  examViolationWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_VIOLATION_WINDOW_MS, 60 * 1000),
  examViolationMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_VIOLATION_MAX, 12),
  examSubmitWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_SUBMIT_WINDOW_MS, 15 * 1000),
  examSubmitMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_SUBMIT_MAX, 3),
  examStartWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_START_WINDOW_MS, 60 * 1000),
  examStartMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_START_MAX, 20),
  examListWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_LIST_WINDOW_MS, 30 * 1000),
  examListMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_LIST_MAX, 20),
  examSessionWindowMs: toPositiveInt(process.env.RATE_LIMIT_EXAM_SESSION_WINDOW_MS, 30 * 1000),
  examSessionMax: toPositiveInt(process.env.RATE_LIMIT_EXAM_SESSION_MAX, 30),
  eventRegisterWindowMs: toPositiveInt(process.env.RATE_LIMIT_EVENT_REGISTER_WINDOW_MS, 60 * 1000),
  eventRegisterMax: toPositiveInt(process.env.RATE_LIMIT_EVENT_REGISTER_MAX, 6),
  studentReportWindowMs: toPositiveInt(process.env.RATE_LIMIT_STUDENT_REPORT_WINDOW_MS, 60 * 1000),
  studentReportMax: toPositiveInt(process.env.RATE_LIMIT_STUDENT_REPORT_MAX, 10),
  generalApiWindowMs: toPositiveInt(process.env.RATE_LIMIT_GENERAL_API_WINDOW_MS, 60 * 1000),
  generalApiMax: toPositiveInt(process.env.RATE_LIMIT_GENERAL_API_MAX, 240),
  reportGenerationWindowMs: toPositiveInt(process.env.RATE_LIMIT_REPORT_GENERATION_WINDOW_MS, 60 * 1000),
  reportGenerationMax: toPositiveInt(process.env.RATE_LIMIT_REPORT_GENERATION_MAX, 10),
  adminReportReadWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_REPORT_READ_WINDOW_MS, 30 * 1000),
  adminReportReadMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_REPORT_READ_MAX, 20),
  adminTestListWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_LIST_WINDOW_MS, 30 * 1000),
  adminTestListMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_TEST_LIST_MAX, 30),
  adminBatchGuardWindowMs: toPositiveInt(process.env.RATE_LIMIT_ADMIN_BATCH_GUARD_WINDOW_MS, 60 * 1000),
  adminBatchGuardMax: toPositiveInt(process.env.RATE_LIMIT_ADMIN_BATCH_GUARD_MAX, 12),
  superReportWindowMs: toPositiveInt(process.env.RATE_LIMIT_SUPER_REPORT_WINDOW_MS, 60 * 1000),
  superReportMax: toPositiveInt(process.env.RATE_LIMIT_SUPER_REPORT_MAX, 20),
  leaderboardWindowMs: toPositiveInt(process.env.RATE_LIMIT_LEADERBOARD_WINDOW_MS, 30 * 1000),
  leaderboardMax: toPositiveInt(process.env.RATE_LIMIT_LEADERBOARD_MAX, 20),
  searchWindowMs: toPositiveInt(process.env.RATE_LIMIT_SEARCH_WINDOW_MS, 30 * 1000),
  searchMax: toPositiveInt(process.env.RATE_LIMIT_SEARCH_MAX, 30),
  metricsTopNDefault: toPositiveInt(process.env.RATE_LIMIT_METRICS_TOP_N_DEFAULT, 10),
};

const responseCache = {
  enabled: toBoolean(process.env.RESPONSE_CACHE_ENABLED, true),
  adminReportsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_REPORTS_TTL_SECONDS, 30),
  adminSearchTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_SEARCH_TTL_SECONDS, 10),
  superAnalyticsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_SUPER_ANALYTICS_TTL_SECONDS, 30),
  studentDashboardTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_STUDENT_DASHBOARD_TTL_SECONDS, 15),
  studentTestsTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_STUDENT_TESTS_TTL_SECONDS, 20),
  adminDashboardTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_ADMIN_DASHBOARD_TTL_SECONDS, 20),
  superDashboardTtlSeconds: toPositiveInt(process.env.RESPONSE_CACHE_SUPER_DASHBOARD_TTL_SECONDS, 20),
};

const redis = {
  enabled: toBoolean(process.env.REDIS_ENABLED, nodeEnv !== "development" && nodeEnv !== "test"),
  connectTimeoutMs: toPositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 10_000),
  keepAliveMs: toPositiveInt(process.env.REDIS_KEEP_ALIVE_MS, 30_000),
  maxRetryDelayMs: toPositiveInt(process.env.REDIS_MAX_RETRY_DELAY_MS, 2_000),
  queueEnabled: toBoolean(process.env.REDIS_QUEUE_ENABLED, nodeEnv !== "development" && nodeEnv !== "test"),
};

module.exports = {
  port: Number(process.env.PORT || 5000),
  nodeEnv,
  mongoUri: process.env.MONGODB_URI,
  mongoDbName: process.env.MONGODB_DB_NAME || "lms_portal",
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "5mb",
  superAdminEmail: process.env.SUPERADMIN_EMAIL || "",
  superAdminPassword: process.env.SUPERADMIN_PASSWORD || "",
  superAdminName: process.env.SUPERADMIN_NAME || "Super Admin",
  jwtAccessSecret,
  jwtRefreshSecret,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  frontendOrigin: frontendOrigins[0] || "http://localhost:5173",
  frontendOrigins,
  redisUrl: process.env.REDIS_URL || "",
  redis,
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER || "lms-portal",
  rateLimit,
  responseCache,
};
