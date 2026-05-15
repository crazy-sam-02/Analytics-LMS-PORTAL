const models = require("../models");

const SubmissionStatus = {
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  AUTO_SUBMITTED: "AUTO_SUBMITTED",
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const isQuestionCorrect = (question, answer) => {
  if (!answer) return false;

  if (question.type === "MCQ" || question.type === "SINGLE_SELECT") {
    return normalize(answer.selectedOption) === normalize(question.correctOption);
  }

  if (question.type === "TRUE_FALSE") {
    const resolvedBoolean = typeof answer.answerBoolean === "boolean"
      ? answer.answerBoolean
      : answer.selectedBoolean;
    return resolvedBoolean === question.correctBoolean;
  }

  const resolvedText = answer.answerText ?? answer.selectedText;
  return normalize(resolvedText) === normalize(question.correctText);
};

const calculateSubmissionScore = async (submissionId) => {
  const m = await models.init();
  const db = m.dbClient;
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: {
      test: {
        include: {
          questions: true,
        },
      },
      answers: true,
    },
  });

  if (!submission) return null;

  const questions = Array.isArray(submission.test?.questions)
    ? submission.test.questions
    : [];
  const answers = Array.isArray(submission.answers) ? submission.answers : [];
  const totalQuestions = questions.length;
  const totalMarks = questions.reduce((acc, q) => acc + Number(q?.marks || 0), 0);

  let scoredMarks = 0;
  for (const question of questions) {
    const answer = answers.find((item) => item.questionId === question.id);
    if (isQuestionCorrect(question, answer)) {
      scoredMarks += Number(question?.marks || 0);
    }
  }

  const accuracy = totalMarks > 0 ? (scoredMarks / totalMarks) * 100 : 0;
  const completion = totalQuestions > 0 ? (answers.length / totalQuestions) * 100 : 0;

  return {
    score: Number(scoredMarks.toFixed(2)),
    accuracy: Number(accuracy.toFixed(2)),
    completion: Number(completion.toFixed(2)),
    totalQuestions,
  };
};

const completeSubmission = async ({ submissionId, autoSubmitted = false }) => {
  const m = await models.init();
  const db = m.dbClient;
  const scoreData = await calculateSubmissionScore(submissionId);

  if (!scoreData) {
    return null;
  }

  const existing = await db.submission.findUnique({ where: { id: submissionId } });
  if (!existing) {
    return null;
  }

  if (existing.status !== SubmissionStatus.IN_PROGRESS) {
    return existing;
  }

  const timeSpentSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(existing.startedAt).getTime()) / 1000)
  );

  // Atomic completion guard to prevent duplicate submit races.
  const submitStatus = autoSubmitted ? SubmissionStatus.AUTO_SUBMITTED : SubmissionStatus.SUBMITTED;
  const submittedAt = new Date();

  const updatedCount = await db.submission.updateMany({
    where: {
      id: submissionId,
      status: SubmissionStatus.IN_PROGRESS,
    },
    data: {
      score: scoreData.score,
      accuracy: scoreData.accuracy,
      timeSpentSeconds,
      status: submitStatus,
      submittedAt,
      completedReason: autoSubmitted ? "AUTO" : "MANUAL",
      completionLockAt: submittedAt,
    },
  });

  const updatedSubmission = await db.submission.findUnique({ where: { id: submissionId } });

  if (!updatedSubmission) {
    return null;
  }

  if ((updatedCount?.count || 0) > 0) {
    await db.testSession.updateMany({
      where: {
        submissionId,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
        connectionStatus: "OFFLINE",
      },
    });
  }

  return updatedSubmission;
};

module.exports = {
  calculateSubmissionScore,
  completeSubmission,
};
