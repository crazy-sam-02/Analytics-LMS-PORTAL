const prisma = require("../../config/db");
const { asyncHandler } = require("../../utils/http");

const getSuperAnalytics = asyncHandler(async (_req, res) => {
  const [topCollegesRaw, topStudentsRaw, activeTestsRaw, violationsRaw] = await Promise.all([
    prisma.college.findMany({
      where: { isActive: true },
      include: {
        submissions: {
          where: { status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
          select: { score: true },
        },
      },
      take: 20,
    }),
    prisma.student.findMany({
      where: { isActive: true },
      include: {
        submissions: {
          where: { status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] } },
          select: { score: true },
        },
        college: {
          select: { name: true },
        },
      },
      take: 100,
    }),
    prisma.test.findMany({
      include: {
        submissions: {
          select: { id: true },
        },
      },
      take: 200,
    }),
    prisma.violation.groupBy({
      by: ["type"],
      _count: { type: true },
    }),
  ]);

  const topColleges = topCollegesRaw
    .map((college) => {
      const count = college.submissions.length;
      const avgScore = count > 0 ? college.submissions.reduce((sum, item) => sum + item.score, 0) / count : 0;
      return {
        collegeId: college.id,
        collegeName: college.name,
        avgScore: Number(avgScore.toFixed(2)),
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);

  const topStudents = topStudentsRaw
    .map((student) => {
      const count = student.submissions.length;
      const avgScore = count > 0 ? student.submissions.reduce((sum, item) => sum + item.score, 0) / count : 0;
      return {
        studentId: student.id,
        studentName: student.fullName,
        collegeName: student.college.name,
        avgScore: Number(avgScore.toFixed(2)),
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);

  const mostActiveTests = activeTestsRaw
    .map((test) => ({
      testId: test.id,
      testName: test.title,
      collegeId: test.collegeId,
      submissions: test.submissions.length,
    }))
    .sort((a, b) => b.submissions - a.submissions)
    .slice(0, 10);

  res.status(200).json({
    topPerformingColleges: topColleges,
    topStudents,
    mostActiveTests,
    violationStatistics: violationsRaw.map((entry) => ({ type: entry.type, count: entry._count.type })),
  });
});

module.exports = {
  getSuperAnalytics,
};
