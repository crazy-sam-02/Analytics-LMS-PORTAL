const prisma = require("../../config/db");
const { asyncHandler } = require("../../utils/http");

const getSuperAdminDashboard = asyncHandler(async (_req, res) => {
  const now = new Date();

  const [
    totalColleges,
    totalAdmins,
    totalStudents,
    totalTests,
    activeUsers,
    submissions,
    collegePerformance,
  ] = await Promise.all([
    prisma.college.count({ where: { isActive: true } }),
    prisma.admin.count({ where: { isActive: true } }),
    prisma.student.count({ where: { isActive: true } }),
    prisma.test.count(),
    prisma.submission.count({
      where: {
        status: { in: ["IN_PROGRESS", "SUBMITTED", "AUTO_SUBMITTED"] },
        updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.submission.findMany({
      where: {
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
        submittedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        submittedAt: true,
        score: true,
        collegeId: true,
      },
      orderBy: { submittedAt: "asc" },
    }),
    prisma.college.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        submissions: {
          where: { status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
          select: { score: true },
        },
      },
      take: 20,
    }),
  ]);

  const dailyMap = new Map();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, 0);
  }

  submissions.forEach((item) => {
    if (!item.submittedAt) return;
    const key = item.submittedAt.toISOString().slice(0, 10);
    if (dailyMap.has(key)) {
      dailyMap.set(key, dailyMap.get(key) + 1);
    }
  });

  const collegeWisePerformance = collegePerformance.map((college) => {
    const participantCount = college.submissions.length;
    const avgScore = participantCount > 0
      ? college.submissions.reduce((sum, row) => sum + row.score, 0) / participantCount
      : 0;

    return {
      collegeId: college.id,
      collegeName: college.name,
      participants: participantCount,
      avgScore: Number(avgScore.toFixed(2)),
    };
  });

  res.status(200).json({
    cards: {
      totalColleges,
      totalAdmins,
      totalStudents,
      totalTests,
      activeUsers,
    },
    charts: {
      dailyActiveUsers: Array.from(dailyMap.entries()).map(([day, users]) => ({ day, users })),
      testParticipationTrend: Array.from(dailyMap.entries()).map(([day, count]) => ({ day, count })),
      collegeWisePerformance,
    },
  });
});

module.exports = {
  getSuperAdminDashboard,
};
