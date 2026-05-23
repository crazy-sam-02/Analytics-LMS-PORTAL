const models = require("../../models");
const { asyncHandler, ApiError } = require("../../utils/http");
const {
  completeSubmission,
  findAnswerForQuestion,
  getAnswerBoolean,
  getAnswerSelectedOption,
  getAnswerSelectedOptions,
  getAnswerText,
  isQuestionCorrect,
} = require("../../services/test.service");
const {
  canRevealCorrectAnswers,
  isTestCompleted,
  maskCorrectAnswer,
  resolveReviewMode,
} = require("../../services/student-review-policy.service");
const { clampPercent, getSubmissionScorePercent, getTestTotalMarks } = require("../../utils/score");

const toPercent = (value) => clampPercent(value);

const getSubmissionTotalMarks = (submission) => getTestTotalMarks(submission?.test);

const formatAnswerValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not answered";
  if (value == null) return "Not answered";
  if (typeof value === "boolean") return value ? "True" : "False";
  const text = String(value).trim();
  return text || "Not answered";
};

const resolveStudentAnswerValue = (answer, type) => {
  if (!answer) return null;
  if (type === "MCQ_MULTI" || type === "MULTI_SELECT") return getAnswerSelectedOptions(answer);
  if (type === "TRUE_FALSE" || type === "BOOLEAN") return getAnswerBoolean(answer);
  return getAnswerSelectedOption(answer) ?? getAnswerText(answer) ?? getAnswerBoolean(answer);
};

const hasTestEnded = (test = {}) => {
  const endsAt = test?.endsAt || test?.endDate || test?.end_date || test?.ends_at;
  if (!endsAt) return false;
  const endsAtMs = new Date(endsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs <= Date.now();
};

const finalizeClosedStudentSubmissions = async ({ db, userId }) => {
  const staleSubmissions = await db.submission.findMany({
    where: {
      userId,
      status: "IN_PROGRESS",
    },
    include: {
      test: true,
    },
  });

  const closable = staleSubmissions.filter((submission) =>
    isTestCompleted(submission.test) || hasTestEnded(submission.test)
  );

  if (closable.length > 0) {
    await Promise.all(
      closable.map((submission) =>
        completeSubmission({ submissionId: submission.id, autoSubmitted: true })
      )
    );
  }

  return closable.length;
};

const getReport = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const view = String(req.query.view || "overall").toLowerCase();
  const testId = String(req.query.test_id || "").trim();

  await finalizeClosedStudentSubmissions({ db, userId: req.user.id });

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

  const submissionsWithMetrics = submissions.map((item) => ({
    ...item,
    scorePercent: getSubmissionScorePercent(item),
    totalMarks: getSubmissionTotalMarks(item),
    obtainedMarks: Number(item.score || 0),
  }));

  const total = submissionsWithMetrics.length;
  const avgScorePercent = total > 0 ? submissionsWithMetrics.reduce((acc, item) => acc + Number(item.scorePercent || 0), 0) / total : 0;
  const bestAttempt = submissionsWithMetrics.reduce((best, current) => {
    if (!best) return current;
    return Number(current.scorePercent || 0) > Number(best.scorePercent || 0) ? current : best;
  }, null);

  const lineChart = submissionsWithMetrics
    .slice()
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .map((item) => ({
      date: new Date(item.submittedAt).toLocaleDateString(),
      value: Number(item.scorePercent || 0),
      score: Number(item.scorePercent || 0),
      accuracy: Number(item.scorePercent || 0),
      obtainedMarks: Number(item.obtainedMarks || 0),
      totalMarks: Number(item.totalMarks || 0),
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

    const isCorrect = isQuestionCorrect(question, answer);

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
      accuracy: toPercent(avgScorePercent),
      completion: 100,
      summary: {
        tests_taken: total,
        avg_score: toPercent(avgScorePercent),
        best_score: toPercent(bestAttempt?.scorePercent || 0),
        best_score_percent: toPercent(bestAttempt?.scorePercent || 0),
        best_score_obtained_marks: Number(bestAttempt?.obtainedMarks || 0),
        best_score_total_marks: Number(bestAttempt?.totalMarks || 0),
        missed_tests: 0,
      },
      line_chart: lineChart,
      topic_performance: topicPerformance,
    },
    testWise: submissionsWithMetrics.map((item) => ({
      submissionId: item.id,
      testId: item.testId,
      testName: item.test?.title || "Test",
      subject: item.test?.subject || "",
      endDate: item.test?.endsAt || null,
      testStatus: item.test?.status || null,
      test_status: item.test?.status || null,
      isTestCompleted: isTestCompleted(item.test),
      is_test_completed: isTestCompleted(item.test),
      score: Number(item.scorePercent || 0),
      scorePercent: Number(item.scorePercent || 0),
      accuracy: Number(item.scorePercent || 0),
      obtainedMarks: Number(item.obtainedMarks || 0),
      totalMarks: Number(item.totalMarks || 0),
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

    const revealQuestionDetails = canRevealCorrectAnswers(target.test);
    const testCompleted = isTestCompleted(target.test);
    const reviewMode = revealQuestionDetails ? "show_all" : resolveReviewMode(target.test);
    const question_breakdown = (target.test?.questions || []).map((question) => {
      const answer = findAnswerForQuestion(target.answers, question);
      const type = String(question.type || "").toUpperCase();
      const isCorrect = isQuestionCorrect(question, answer);

      const studentAnswer = formatAnswerValue(resolveStudentAnswerValue(answer, type));
      const rawCorrectAnswer = formatAnswerValue(
        (type === "MCQ_MULTI" || type === "MULTI_SELECT")
          ? question.correctOptions
          : question.correctOption ?? question.correctText ?? question.correctBoolean
      );
      const correctAnswer = maskCorrectAnswer(rawCorrectAnswer, target.test);

      return {
        question_id: question.id,
        prompt: question.prompt,
        type: question.type,
        student_answer: studentAnswer,
        correct_answer: correctAnswer,
        marks: revealQuestionDetails ? (isCorrect ? Number(question.marks || 0) : 0) : null,
        total_marks: Number(question.marks || 0),
        is_correct: revealQuestionDetails ? Boolean(isCorrect) : null,
        topic: question.topic || target.test?.subject || "General",
      };
    });

    const totalMarks = getTestTotalMarks(target.test);
    const obtainedMarks = Number(target.score || 0);
    const percentage = getSubmissionScorePercent(target);

    payload.by_test = {
      attempt_id: target.id,
      submission_id: target.id,
      total_marks: Number(totalMarks || 0),
      obtained_marks: obtainedMarks,
      percentage: toPercent(percentage),
      percentile,
      time_analytics: {
        total_time: Number(target.timeSpentSeconds || 0),
        avg_time_per_question:
          (target.test?.questions || []).length > 0
            ? Number((Number(target.timeSpentSeconds || 0) / (target.test?.questions || []).length).toFixed(2))
            : 0,
      },
      review_mode: reviewMode,
      test_status: target.test?.status || null,
      testStatus: target.test?.status || null,
      is_test_completed: testCompleted,
      isTestCompleted: testCompleted,
      can_review_answers: revealQuestionDetails,
      canReviewAnswers: revealQuestionDetails,
      test: {
        id: target.test?.id,
        title: target.test?.title,
        subject: target.test?.subject,
        status: target.test?.status,
        test_status: target.test?.status,
        is_completed: testCompleted,
        end_date: target.test?.endsAt,
      },
      questions: question_breakdown,
    };
  }

  res.status(200).json(payload);
});

module.exports = { getReport };
