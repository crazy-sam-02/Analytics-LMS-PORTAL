const prisma = require("../../config/db");
const redisClient = require("../../config/redis");
const { asyncHandler } = require("../../utils/http");

const getLeaderboard = asyncHandler(async (req, res) => {
  const view = String(req.query.view || "overall").trim().toLowerCase();
  const testId = String(req.query.testId || req.query.test_id || "").trim();
  const collegeId = req.query.collegeId || req.user.collegeId;
  const departmentId = req.query.departmentId || req.user.departmentId;
  const batchId = req.query.batchId || req.user.batchId;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));

  if (view === "per_test" && !testId) {
    return res.status(200).json({
      data: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
      },
    });
  }

  const cacheKey = `leaderboard:${view}:${collegeId}:${departmentId}:${batchId}:${testId || "all"}:${page}:${limit}`;
  if (redisClient) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  }

  const userWhere = { collegeId };
  if (view === "department_wise") {
    userWhere.departmentId = departmentId;
  }
  if (view === "batch_wise") {
    userWhere.batchId = batchId;
  }

  const where = {
    status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
    user: userWhere,
  };

  if (testId) {
    where.testId = testId;
  }

  const [total, submissions] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            studentId: true,
          },
        },
        test: {
          select: {
            id: true,
            title: true,
            subject: true,
          },
        },
      },
      orderBy: [{ score: "desc" }, { timeSpentSeconds: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const payload = {
    data: submissions.map((entry, index) => ({
      rank: (page - 1) * limit + index + 1,
      id: entry.id,
      userId: entry.user.id,
      studentName: entry.user.fullName,
      studentId: entry.user.studentId,
      testId: entry.test.id,
      testName: entry.test.title,
      subject: entry.test.subject,
      score: entry.score,
      percentage: entry.accuracy,
      accuracy: entry.accuracy,
      timeTakenSeconds: entry.timeSpentSeconds,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };

  if (redisClient) {
    await redisClient.set(cacheKey, JSON.stringify(payload), "EX", 120);
  }

  res.status(200).json(payload);
});

module.exports = { getLeaderboard };
