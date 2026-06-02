const createResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const createPromotionDb = () => {
  const tx = {
    student: {
      findMany: jest.fn(async () => [{ id: "prior-year-4" }]),
      updateMany: jest.fn(async ({ where }) => {
        if (where.year === 3) return { count: 3 };
        if (where.year === 2) return { count: 2 };
        if (where.year === 1) return { count: 1 };
        if (where.id?.in) return { count: where.id.in.length };
        return { count: 0 };
      }),
    },
  };

  const db = {
    $transaction: jest.fn(async (callback) => callback(tx)),
    studentRefreshToken: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };

  return { db, tx };
};

const invoke = async (handler, req) => {
  const res = createResponse();
  const next = jest.fn();

  handler(req, res, next);
  for (let attempt = 0; attempt < 20 && !res.json.mock.calls.length && !next.mock.calls.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  expect(next).not.toHaveBeenCalled();
  return res;
};

const mockPromotionDependencies = (db) => {
  jest.doMock("../../models", () => ({
    init: jest.fn(async () => ({ dbClient: db })),
  }));
  jest.doMock("../../services/audit.service", () => ({
    createAuditLog: jest.fn(async () => {}),
  }));
  jest.doMock("../../services/refresh-token-cache.service", () => ({
    invalidateRefreshTokenRecord: jest.fn(async () => {}),
  }));
  jest.doMock("../../services/auth-revocation.service", () => ({
    bumpPrincipalTokenVersion: jest.fn(async () => {}),
    invalidatePrincipalAuthCache: jest.fn(async () => {}),
  }));
};

describe("student year promotion controllers", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("promotes super-admin student years from highest to lowest to avoid cascading updates", async () => {
    const { db, tx } = createPromotionDb();
    mockPromotionDependencies(db);
    jest.doMock("../../config/redis", () => ({
      redisClient: null,
      getRedisQueueConnection: jest.fn(() => null),
    }));

    const { promoteStudentsYearGlobal } = require("../../controllers/SuperAdmin/students.controller");

    const res = await invoke(promoteStudentsYearGlobal, {
      body: {
        collegeId: "college-1",
        confirmationText: "PROMOTE STUDENTS YEAR",
      },
      superAdmin: { id: "super-admin-1" },
    });

    expect(tx.student.updateMany.mock.calls.map(([args]) => args.where.year || "prior4")).toEqual([
      3,
      2,
      1,
      "prior4",
    ]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: {
        year1To2: 1,
        year2To3: 2,
        year3To4: 3,
        deactivatedPrior4: 1,
      },
    }));
  });

  it("promotes admin student years from highest to lowest to avoid cascading updates", async () => {
    const { db, tx } = createPromotionDb();
    mockPromotionDependencies(db);
    jest.doMock("../../services/admin-student.service", () => ({}));
    jest.doMock("../../utils/admin-scope", () => ({
      getScopedDepartmentId: jest.fn(),
      assertDepartmentScope: jest.fn(),
    }));

    const { promoteStudentsYear } = require("../../controllers/Admin/students.controller");

    await invoke(promoteStudentsYear, {
      body: {
        confirmationText: "PROMOTE STUDENTS YEAR",
      },
      collegeId: "college-1",
      admin: { id: "admin-1" },
    });

    expect(tx.student.updateMany.mock.calls.map(([args]) => args.where.year || "prior4")).toEqual([
      3,
      2,
      1,
      "prior4",
    ]);
  });
});
