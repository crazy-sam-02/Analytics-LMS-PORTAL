describe("super admin report queue payload builder", () => {
  const loadService = () => {
    jest.resetModules();
    jest.doMock("../../config/redis", () => ({
      redisClient: null,
      getRedisQueueConnection: jest.fn(() => null),
    }));
    return require("../../services/super-admin-report-queue.service");
  };

  it("filters student-wise exports to completed submissions inside the requested date range", async () => {
    const { buildGlobalReportPayload } = loadService();
    const findMany = jest.fn(async () => []);
    const db = {
      batch: { findMany: jest.fn(async () => []) },
      submission: { findMany },
    };

    await buildGlobalReportPayload(db, {
      type: "STUDENT_WISE",
      filters: {
        collegeId: "college-1",
        dateFrom: "2026-01-01T00:00:00.000Z",
        dateTo: "2026-01-31T23:59:59.000Z",
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        collegeId: "college-1",
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
        submittedAt: {
          gte: new Date("2026-01-01T00:00:00.000Z"),
          lte: new Date("2026-01-31T23:59:59.000Z"),
        },
      }),
    }));
  });

  it("filters nested test-wise export submissions to completed attempts", async () => {
    const { buildGlobalReportPayload } = loadService();
    const testFindMany = jest.fn(async () => []);
    const db = {
      batch: { findMany: jest.fn(async () => []) },
      test: { findMany: testFindMany },
    };

    await buildGlobalReportPayload(db, {
      type: "TEST_WISE",
      filters: {
        collegeId: "college-1",
        studentId: "student-1",
      },
    });

    expect(testFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        submissions: expect.objectContaining({
          where: expect.objectContaining({
            userId: "student-1",
            status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
          }),
        }),
      }),
    }));
  });
});
