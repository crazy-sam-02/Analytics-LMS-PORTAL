const prisma = require("../../config/db");
const { asyncHandler } = require("../../utils/http");

const getAdminDashboard = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const now = new Date();

  const [
    totalStudents,
    totalTests,
    activeTests,
    upcomingTests,
    recentSubmissions,
    recentActivity,
    tests,
  ] = await Promise.all([
    prisma.student.count({ where: { collegeId, isActive: true } }),
    prisma.test.count({ where: { collegeId } }),
    prisma.test.count({
      where: {
        collegeId,
        startsAt: { lte: now },
        endsAt: { gte: now },
        isPublished: true,
      },
    }),
    prisma.test.count({
      where: {
        collegeId,
        startsAt: { gt: now },
      },
    }),
    prisma.submission.findMany({
      where: {
        collegeId,
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      },
      include: {
        user: {
          select: { fullName: true, studentId: true },
        },
        test: {
          select: { title: true },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: 10,
    }),
    prisma.auditLog.findMany({
      where: { collegeId },
      include: {
        admin: {
          select: { fullName: true, email: true },
        },
        test: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.test.findMany({
      where: { collegeId },
      include: {
        submissions: {
          where: { status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
          select: {
            id: true,
            score: true,
            submittedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);

  const participationTrendMap = new Map();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setMonth(now.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    participationTrendMap.set(key, 0);
  }

  tests.forEach((test) => {
    test.submissions.forEach((submission) => {
      if (!submission.submittedAt) return;
      const d = new Date(submission.submittedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (participationTrendMap.has(key)) {
        participationTrendMap.set(key, participationTrendMap.get(key) + 1);
      }
    });
  });

  const averageScorePerTest = tests.map((test) => {
    const count = test.submissions.length;
    const avgScore = count > 0 ? test.submissions.reduce((acc, item) => acc + item.score, 0) / count : 0;
    return {
      testId: test.id,
      testName: test.title,
      averageScore: Number(avgScore.toFixed(2)),
      participants: count,
    };
  });

  res.status(200).json({
    cards: {
      totalStudents,
      totalTestsCreated: totalTests,
      activeTests,
      upcomingTests,
    },
    recentSubmissions,
    recentActivity,
    charts: {
      testParticipationTrend: Array.from(participationTrendMap.entries()).map(([month, count]) => ({ month, count })),
      averageScorePerTest,
    },
  });
});

module.exports = {
  getAdminDashboard,
};
