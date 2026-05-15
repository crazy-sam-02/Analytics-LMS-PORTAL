const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const parseOptions = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      // Ignore parse errors and fallback to comma split.
    }

    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const compareMultiSelect = (actual, expected) => {
  const actualSet = new Set(parseOptions(actual).map((item) => normalizeText(item)));
  const expectedSet = new Set(parseOptions(expected).map((item) => normalizeText(item)));

  if (actualSet.size !== expectedSet.size) return false;
  return [...actualSet].every((item) => expectedSet.has(item));
};

const formatAnswerValue = (value) => {
  if (Array.isArray(value)) return value.join(", ");
  if (value == null) return "Not answered";
  if (typeof value === "boolean") return value ? "True" : "False";
  const text = String(value).trim();
  return text || "Not answered";
};

const getReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
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

  const submissions = await db.submission.findMany({
    ...baseWhere,
    include: {
      test: true,
    },
    orderBy: {
      submittedAt: "desc",
    },
  });

  const total = submissions.length;
  const avgAccuracy = total > 0 ? submissions.reduce((acc, item) => acc + Number(item.accuracy || 0), 0) / total : 0;
  const bestScore = total > 0 ? Math.max(...submissions.map((item) => Number(item.score || 0))) : 0;

  const lineChart = submissions
    .slice()
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .map((item) => ({
      date: new Date(item.submittedAt).toLocaleDateString(),
      value: Number(item.accuracy || 0),
      score: Number(item.score || 0),
      accuracy: Number(item.accuracy || 0),
      label: item.test?.title || "Test",
    }));

  const answersForTopics = await db.answer.findMany({
    where: {
      submissionId: {
        in: submissions.map((item) => item.id),
      },
    },
    include: {
      question: {
        select: {
          id: true,
          topic: true,
          type: true,
          correctOption: true,
          correctText: true,
          correctBoolean: true,
          correctOptions: true,
        },
      },
      submission: {
        select: {
          test: {
            select: {
              subject: true,
            },
          },
        },
      },
    },
  });

  const topicAgg = new Map();
  answersForTopics.forEach((answer) => {
    const question = answer.question;
    if (!question) return;

    const topicName = question.topic || answer.submission?.test?.subject || "General";
    const key = String(topicName);

    const type = String(question.type || "").toUpperCase();
    const isCorrect =
      (type === "MCQ" || type === "MCQ_SINGLE" || type === "SINGLE_SELECT")
        ? normalizeText(answer.selectedOption) === normalizeText(question.correctOption)
        : (type === "MCQ_MULTI" || type === "MULTI_SELECT")
          ? compareMultiSelect(answer.selectedOptions, question.correctOptions)
          : (type === "TRUE_FALSE" || type === "BOOLEAN")
            ? answer.answerBoolean === question.correctBoolean
            : normalizeText(answer.answerText) === normalizeText(question.correctText);

    const current = topicAgg.get(key) || { correct: 0, total: 0, topic: key };
    current.total += 1;
    if (isCorrect) current.correct += 1;
    topicAgg.set(key, current);
  });

  const topicPerformance = [...topicAgg.values()]
    .map((item) => ({
      topic: item.topic,
      value: item.total > 0 ? Number(((item.correct / item.total) * 100).toFixed(2)) : 0,
      score: item.total > 0 ? Number(((item.correct / item.total) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const payload = {
    overall: {
      totalTests: total,
      accuracy: Number(avgAccuracy.toFixed(2)),
      completion: 100,
      summary: {
        tests_taken: total,
        avg_score: Number(avgAccuracy.toFixed(2)),
        best_score: Number(bestScore.toFixed(2)),
        missed_tests: 0,
      },
      line_chart: lineChart,
      topic_performance: topicPerformance,
    },
    testWise: submissions.map((item) => ({
      submissionId: item.id,
      testId: item.testId,
      testName: item.test?.title || "Test",
      subject: item.test?.subject || "",
      endDate: item.test?.endsAt || null,
      score: item.score,
      accuracy: item.accuracy,
      timeSpentSeconds: item.timeSpentSeconds,
      submittedAt: item.submittedAt,
    })),
    charts: {
      lineChart,
      radarChart: topicPerformance,
    },
  };

  if (view === "by_test") {
    if (!testId) {
      throw new ApiError(422, "test_id is required for by_test view", null, "TEST_ID_REQUIRED");
    }

    const target = await db.submission.findFirst({
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
      db.submission.findMany({
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
      const type = String(question.type || "").toUpperCase();
      const isCorrect = answer
        ? (type === "MCQ" || type === "MCQ_SINGLE" || type === "SINGLE_SELECT")
          ? normalizeText(answer.selectedOption) === normalizeText(question.correctOption)
          : (type === "MCQ_MULTI" || type === "MULTI_SELECT")
            ? compareMultiSelect(answer.selectedOptions, question.correctOptions)
            : (type === "TRUE_FALSE" || type === "BOOLEAN")
              ? answer.answerBoolean === question.correctBoolean
              : normalizeText(answer.answerText) === normalizeText(question.correctText)
        : false;

      const studentAnswer = formatAnswerValue(
        (type === "MCQ_MULTI" || type === "MULTI_SELECT")
          ? answer?.selectedOptions
          : answer?.selectedOption ?? answer?.answerText ?? answer?.answerBoolean
      );
      const correctAnswer = formatAnswerValue(
        (type === "MCQ_MULTI" || type === "MULTI_SELECT")
          ? question.correctOptions
          : question.correctOption ?? question.correctText ?? question.correctBoolean
      );

      return {
        question_id: question.id,
        prompt: question.prompt,
        type: question.type,
        student_answer: studentAnswer,
        correct_answer: correctAnswer,
        marks: isCorrect ? Number(question.marks || 0) : 0,
        total_marks: Number(question.marks || 0),
        is_correct: Boolean(isCorrect),
        topic: question.topic || target.test?.subject || "General",
      };
    });

    const totalMarks = (target.test?.questions || []).reduce((acc, question) => acc + Number(question.marks || 0), 0);

    payload.by_test = {
      attempt_id: target.id,
      submission_id: target.id,
      total_marks: Number(target.test?.totalMarks || totalMarks),
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
