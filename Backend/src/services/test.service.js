const prisma = require("../config/db");

const SubmissionStatus = {
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  AUTO_SUBMITTED: "AUTO_SUBMITTED",
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const isQuestionCorrect = (question, answer) => {
  if (!answer) return false;

  if (question.type === "MCQ") {
    return normalize(answer.selectedOption) === normalize(question.correctOption);
  }

  if (question.type === "TRUE_FALSE") {
    return answer.answerBoolean === question.correctBoolean;
  }

  return normalize(answer.answerText) === normalize(question.correctText);
};

const calculateSubmissionScore = async (submissionId) => {
  const submission = await prisma.submission.findUnique({
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

  const totalQuestions = submission.test.questions.length;
  const totalMarks = submission.test.questions.reduce((acc, q) => acc + q.marks, 0);

  let scoredMarks = 0;
  for (const question of submission.test.questions) {
    const answer = submission.answers.find((item) => item.questionId === question.id);
    if (isQuestionCorrect(question, answer)) {
      scoredMarks += question.marks;
    }
  }

  const accuracy = totalMarks > 0 ? (scoredMarks / totalMarks) * 100 : 0;
  const completion = totalQuestions > 0 ? (submission.answers.length / totalQuestions) * 100 : 0;

  return {
    score: Number(scoredMarks.toFixed(2)),
    accuracy: Number(accuracy.toFixed(2)),
    completion: Number(completion.toFixed(2)),
    totalQuestions,
  };
};

const completeSubmission = async ({ submissionId, autoSubmitted = false }) => {
  const scoreData = await calculateSubmissionScore(submissionId);

  if (!scoreData) {
    return null;
  }

  const existing = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!existing || existing.status !== SubmissionStatus.IN_PROGRESS) {
    return existing;
  }

  const timeSpentSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(existing.startedAt).getTime()) / 1000)
  );

  const updatedSubmission = await prisma.submission.update({
    where: { id: submissionId },
    data: {
      score: scoreData.score,
      accuracy: scoreData.accuracy,
      timeSpentSeconds,
      status: autoSubmitted ? SubmissionStatus.AUTO_SUBMITTED : SubmissionStatus.SUBMITTED,
      submittedAt: new Date(),
    },
  });

  await prisma.testSession.updateMany({
    where: {
      submissionId,
      endedAt: null,
    },
    data: {
      endedAt: new Date(),
    },
  });

  return updatedSubmission;
};

module.exports = {
  calculateSubmissionScore,
  completeSubmission,
};
