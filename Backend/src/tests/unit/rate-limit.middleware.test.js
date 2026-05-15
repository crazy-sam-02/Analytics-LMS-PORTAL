describe("createRateLimiter", () => {
  const loadModule = () => {
    jest.resetModules();

    const recordRateLimitEvent = jest.fn().mockResolvedValue(undefined);

    jest.doMock("../../config/redis", () => ({
      redisClient: {
        incr: jest.fn(),
        pexpire: jest.fn(),
        pttl: jest.fn(),
      },
      isRedisAvailable: () => false,
    }));

    jest.doMock("../../services/rate-limit-metrics.service", () => ({
      recordRateLimitEvent,
    }));

    const rateLimitModule = require("../../middleware/rate-limit");

    return {
      ...rateLimitModule,
      recordRateLimitEvent,
    };
  };

  const invokeLimiter = async (limiter, reqOverrides = {}) => {
    const headers = {};
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    let nextError = null;

    const req = {
      headers: {},
      params: {},
      body: {},
      path: "/api/tests/test-1/answer",
      originalUrl: "/api/tests/test-1/answer",
      ip: "127.0.0.1",
      user: {
        id: "student-1",
        role: "STUDENT",
        collegeId: "college-1",
      },
      ...reqOverrides,
    };

    const res = {
      setHeader(name, value) {
        headers[name] = value;
      },
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };

    await limiter(req, res, (error) => {
      nextCalled = true;
      nextError = error || null;
    });

    return {
      headers,
      statusCode,
      payload,
      nextCalled,
      nextError,
    };
  };

  it("keeps separate scopes independent for the same student attempt", async () => {
    const { createRateLimiter, recordRateLimitEvent } = loadModule();

    const sharedKey = () => "user:STUDENT:student-1:test:test-1:attempt:attempt-1";
    const answerLimiter = createRateLimiter({
      scope: "student-exam-answer",
      routeLabel: "/api/tests/:testId/answer",
      max: 1,
      windowMs: 60_000,
      keySelector: sharedKey,
    });
    const heartbeatLimiter = createRateLimiter({
      scope: "student-exam-heartbeat",
      routeLabel: "/api/tests/:testId/heartbeat",
      max: 1,
      windowMs: 60_000,
      keySelector: sharedKey,
    });

    const firstAnswer = await invokeLimiter(answerLimiter);
    expect(firstAnswer.nextCalled).toBe(true);
    expect(firstAnswer.statusCode).toBeNull();

    const blockedAnswer = await invokeLimiter(answerLimiter);
    expect(blockedAnswer.nextCalled).toBe(false);
    expect(blockedAnswer.statusCode).toBe(429);
    expect(blockedAnswer.payload).toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      details: {
        scope: "student-exam-answer",
      },
    });
    expect(recordRateLimitEvent).toHaveBeenCalledWith(expect.objectContaining({
      scope: "student-exam-answer",
      collegeId: "college-1",
    }));

    const heartbeat = await invokeLimiter(heartbeatLimiter, {
      path: "/api/tests/test-1/heartbeat",
      originalUrl: "/api/tests/test-1/heartbeat",
    });
    expect(heartbeat.nextCalled).toBe(true);
    expect(heartbeat.statusCode).toBeNull();
    expect(recordRateLimitEvent).toHaveBeenCalledTimes(1);
  });
});
