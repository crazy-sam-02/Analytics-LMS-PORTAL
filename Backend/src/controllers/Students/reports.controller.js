const prisma = require("../../config/db");
const { asyncHandler, ApiError } = require("../../utils/http");

const getReport = asyncHandler(async (req, res) => {
  const view = String(req.query.view || "overall").toLowerCase();
  const testId = String(req.query.test_id || "").trim();

  const baseWhere = {
    where: {
      userId: req.user.id,
      status: {
        in: ["SUBMITTED", "AUTO_SUBMITTED"],
      },
    },
  };

  const submissions = await prisma.submission.findMany({
    ...baseWhere,
    include: {
      test: true,
    },
    orderBy: {
      submittedAt: "desc",
    },
  });

  const total = submissions.length;
  const avgAccuracy = total > 0 ? submissions.reduce((acc, s) => acc + s.accuracy, 0) / total : 0;
  const completion = total > 0 ? submissions.filter((s) => s.status !== "IN_PROGRESS").length / total : 0;

  const barChart = submissions.map((item) => ({
    test: item.test.title,
    score: item.score,
    accuracy: item.accuracy,
  }));

  const radarChart = [
    {
      metric: "Accuracy",
      value: Number(avgAccuracy.toFixed(2)),
    },
    {
      metric: "Completion",
      value: Number((completion * 100).toFixed(2)),
    },
    {
      metric: "Consistency",
      value: Number((Math.min(100, 60 + total * 5)).toFixed(2)),
    },
    {
      metric: "Speed",
      value:
        total > 0
          ? Number(
              (
                submissions.reduce((acc, s) => acc + Math.max(0, 100 - s.timeSpentSeconds / 60), 0) /
                total
              ).toFixed(2)
            )
          : 0,
    },
  ];

  const payload = {
    overall: {
      totalTests: total,
      accuracy: Number(avgAccuracy.toFixed(2)),
      completion: Number((completion * 100).toFixed(2)),
    },
    testWise: submissions.map((item) => ({
      submissionId: item.id,
      testId: item.testId,
      testName: item.test.title,
      subject: item.test.subject,
      endDate: item.test.endsAt,
      score: item.score,
      accuracy: item.accuracy,
      timeSpentSeconds: item.timeSpentSeconds,
      submittedAt: item.submittedAt,
    })),
    charts: {
      barChart,
      radarChart,
    },
  };

  if (view === "by_test") {
    if (!testId) {
      throw new ApiError(422, "test_id is required for by_test view", null, "TEST_ID_REQUIRED");
    }

    const target = await prisma.submission.findFirst({
      where: {
        userId: req.user.id,
        testId,
        status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      },
      include: {
        test: {
          include: {
            questions: {
              orderBy: { order: "asc" },
            },
          },
        },
        answers: {
          include: {
            question: true,
          },
        },
      },
      orderBy: {
        submittedAt: "desc",
      },
    });

    if (!target) {
      throw new ApiError(404, "No submitted attempt found for selected test", { test_id: testId }, "TEST_REPORT_NOT_FOUND");
    }

    const [rankedScores] = await Promise.all([
      prisma.submission.findMany({
        where: {
          testId: target.testId,
          status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
        },
        select: { score: true },
        orderBy: { score: "desc" },
      }),
    ]);

    const totalRanked = rankedScores.length || 1;
    const higherCount = rankedScores.filter((item) => Number(item.score || 0) > Number(target.score || 0)).length;
    const percentile = Number((((totalRanked - higherCount) / totalRanked) * 100).toFixed(2));

    const answerByQuestionId = new Map((target.answers || []).map((item) => [item.questionId, item]));
    const question_breakdown = (target.test?.questions || []).map((question) => {
      const answer = answerByQuestionId.get(question.id);
      const studentAnswer = answer?.selectedOption ?? answer?.answerText ?? answer?.answerBoolean ?? "Not answered";
      const correctAnswer = question.correctOption ?? question.correctText ?? question.correctBoolean ?? "-";
      const isCorrect =
        answer &&
        ((question.type === "MCQ" && answer.selectedOption === question.correctOption) ||
          (question.type === "TRUE_FALSE" && answer.answerBoolean === question.correctBoolean) ||
          ((question.type === "FILL_BLANK" || question.type === "PARAGRAPH") &&
            String(answer.answerText || "").trim().toLowerCase() === String(question.correctText || "").trim().toLowerCase()));

      return {
        question_id: question.id,
        prompt: question.prompt,
        type: question.type,
        student_answer: studentAnswer,
        correct_answer: correctAnswer,
        marks: isCorrect ? Number(question.marks || 0) : 0,
        total_marks: Number(question.marks || 0),
        is_correct: Boolean(isCorrect),
        topic: "-",
      };
    });

    payload.by_test = {
      attempt_id: target.id,
      submission_id: target.id,
      total_marks: Number(target.test?.totalMarks || 0),
      obtained_marks: Number(target.score || 0),
      percentage: Number(target.accuracy || 0),
      percentile,
      time_analytics: {
        total_time: Number(target.timeSpentSeconds || 0),
        avg_time_per_question:
          (target.test?.questions || []).length > 0
            ? Number((Number(target.timeSpentSeconds || 0) / (target.test?.questions || []).length).toFixed(2))
            : 0,
      },
      review_mode: "show_after_deadline",
      test: {
        id: target.test?.id,
        title: target.test?.title,
        subject: target.test?.subject,
        end_date: target.test?.endsAt,
      },
      questions: question_breakdown,
    };
  }

  res.status(200).json(payload);
});

module.exports = { getReport };
