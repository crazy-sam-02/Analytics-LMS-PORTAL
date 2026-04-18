const prisma = require("../../config/db");
const { asyncHandler } = require("../../utils/http");

const getSummary = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const now = new Date();

  const submissions = await prisma.submission.findMany({
    where: {
      userId,
      status: {
        in: ["SUBMITTED", "AUTO_SUBMITTED"],
      },
    },
    include: {
      test: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  const totalTestsCompleted = submissions.length;
  const averageAccuracy =
    submissions.length > 0
      ? Number(
          (
            submissions.reduce((acc, item) => acc + item.accuracy, 0) / submissions.length
          ).toFixed(2)
        )
      : 0;

  const ongoingTests = await prisma.test.findMany({
    where: {
      OR: [
        { batchId: req.user.batchId },
        {
          batchAssignments: {
            some: {
              batchId: req.user.batchId,
            },
          },
        },
      ],
      startsAt: { lte: now },
      endsAt: { gte: now },
      isPublished: true,
    },
    orderBy: { startsAt: "asc" },
    include: {
      submissions: {
        where: { userId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          timeSpentSeconds: true,
        },
      },
    },
  });

  const upcomingTests = await prisma.test.findMany({
    where: {
      OR: [
        { batchId: req.user.batchId },
        {
          batchAssignments: {
            some: {
              batchId: req.user.batchId,
            },
          },
        },
      ],
      startsAt: { gt: now },
      isPublished: true,
    },
    orderBy: { startsAt: "asc" },
    take: 10,
  });

  const events = await prisma.event.findMany({
    where: {
      startsAt: { gte: now },
      collegeId: req.user.collegeId,
    },
    orderBy: { startsAt: "asc" },
    take: 5,
  });

  const weeklyActivity = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    const count = submissions.filter((s) => {
      if (!s.submittedAt) return false;
      return s.submittedAt.toISOString().slice(0, 10) === key;
    }).length;
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      completed: count,
    };
  });

  res.status(200).json({
    cards: {
      totalTestsCompleted,
      averageAccuracy,
    },
    ongoingTests,
    upcomingTests,
    weeklyActivity,
    events,
  });
});

module.exports = {
  getSummary,
};
