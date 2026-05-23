const mockMiddleware = (_req, _res, next) => next && next();

const mockEnv = {
  rateLimit: {
    adminReportReadWindowMs: 30_000,
    adminReportReadMax: 20,
    reportGenerationWindowMs: 60_000,
    reportGenerationMax: 10,
    adminTestListWindowMs: 30_000,
    adminTestListMax: 30,
    adminBatchGuardWindowMs: 60_000,
    adminBatchGuardMax: 12,
    superReportWindowMs: 60_000,
    superReportMax: 20,
    leaderboardWindowMs: 30_000,
    leaderboardMax: 20,
  },
};

const loadRouteWithLimiterSpy = (routeModulePath, extraMocks = {}) => {
  jest.resetModules();

  const createRateLimiter = jest.fn(() => mockMiddleware);

  jest.doMock("../../config/env", () => mockEnv);
  jest.doMock("../../middleware/rate-limit", () => ({ createRateLimiter }));
  jest.doMock("../../middleware/validate", () => () => mockMiddleware);
  jest.doMock("../../middleware/auth", () => ({
    authenticate: mockMiddleware,
    authenticateAdmin: mockMiddleware,
    authenticateSuperAdmin: mockMiddleware,
  }));
  jest.doMock("../../middleware/permissions", () => ({
    requireAnyPermission: () => mockMiddleware,
    requirePermission: () => mockMiddleware,
  }));
  jest.doMock("../../middleware/department-guard", () => ({
    requireSameDepartment: () => mockMiddleware,
    departmentMatch: () => mockMiddleware,
  }));
  jest.doMock("../../config/db", () => ({
    test: {
      findFirst: jest.fn(),
    },
  }));

  for (const [path, mockValue] of Object.entries(extraMocks)) {
    jest.doMock(path, () => mockValue);
  }

  require(routeModulePath);

  return createRateLimiter.mock.calls.map(([options]) => options);
};

describe("high-risk route rate limit wiring", () => {
  it("limits admin report analytics and generation routes", () => {
    const limiterConfigs = loadRouteWithLimiterSpy("../../routes/Admin/reports.routes", {
      "../../controllers/Admin/reports.controller": {
        generateReport: mockMiddleware,
        getReportJobs: mockMiddleware,
        getReportJobStatus: mockMiddleware,
        getReportAnalytics: mockMiddleware,
        getReportSummaryDashboard: mockMiddleware,
        getReportChartsDashboard: mockMiddleware,
        getReportTableDashboard: mockMiddleware,
        getReportStudentDetailDashboard: mockMiddleware,
        downloadReport: mockMiddleware,
        regenerateReportLink: mockMiddleware,
        reviewAnomaly: mockMiddleware,
      },
      "../../schemas/Admin/admin-core.schema": {},
    });

    expect(limiterConfigs.map((config) => config.scope)).toEqual([
      "report-generation",
      "admin-report-read",
    ]);
  });

  it("limits admin test list and guarded batch operations", () => {
    const testLimiters = loadRouteWithLimiterSpy("../../routes/Admin/tests.routes", {
      "../../controllers/Admin/tests.controller": {
        createTest: mockMiddleware,
        getTests: mockMiddleware,
        getTestById: mockMiddleware,
        duplicateTest: mockMiddleware,
        cloneTest: mockMiddleware,
        updateTest: mockMiddleware,
        deleteTest: mockMiddleware,
        publishTest: mockMiddleware,
        archiveTest: mockMiddleware,
        transitionTestStatus: mockMiddleware,
        getLiveMonitoring: mockMiddleware,
        forceSubmitAttempt: mockMiddleware,
        extendAttemptTime: mockMiddleware,
      },
      "../../controllers/Admin/batches.controller": {
        assignTestToBatch: mockMiddleware,
        assignTestToDepartment: mockMiddleware,
      },
      "../../schemas/Admin/admin-tests.schema": {},
      "../../schemas/Admin/admin-core.schema": {},
    });
    expect(testLimiters.map((config) => config.scope)).toEqual(["admin-test-list"]);

    const batchLimiters = loadRouteWithLimiterSpy("../../routes/Admin/batches.routes", {
      "../../controllers/Admin/batches-with-validation.controller": {
        getBatches: mockMiddleware,
        getBatchDetail: mockMiddleware,
        createBatchHandler: mockMiddleware,
      },
      "../../controllers/Admin/batches.controller": {
        assignStudentsToBatch: mockMiddleware,
        bulkAddStudentsToBatch: mockMiddleware,
        removeStudentFromBatch: mockMiddleware,
        archiveBatch: mockMiddleware,
        deleteBatch: mockMiddleware,
      },
      "../../schemas/Admin/admin-core.schema": {},
    });
    expect(batchLimiters.map((config) => config.scope)).toEqual(["admin-batch-guard"]);
  });

  it("limits super-admin reports and student leaderboard", () => {
    const superReportLimiters = loadRouteWithLimiterSpy("../../routes/SuperAdmin/reports.routes", {
      "../../controllers/SuperAdmin/reports.controller": {
        generateSuperReport: mockMiddleware,
        getSuperReportAnalytics: mockMiddleware,
        getSuperReportJobs: mockMiddleware,
        downloadSuperReport: mockMiddleware,
        regenerateSuperReportLink: mockMiddleware,
        getEscalatedAnomalies: mockMiddleware,
      },
      "../../schemas/SuperAdmin/super-admin-core.schema": {},
    });
    expect(superReportLimiters.map((config) => config.scope)).toEqual(["super-report"]);

    const leaderboardLimiters = loadRouteWithLimiterSpy("../../routes/Students/leaderboard.routes", {
      "../../controllers/Students/leaderboard.controller": {
        getLeaderboard: mockMiddleware,
      },
    });
    expect(leaderboardLimiters.map((config) => config.scope)).toEqual(["student-leaderboard"]);
  });
});
