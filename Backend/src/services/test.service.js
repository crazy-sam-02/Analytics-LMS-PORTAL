const models = require("../models");

const SubmissionStatus = {
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  AUTO_SUBMITTED: "AUTO_SUBMITTED",
};

const normalize = (value) => String(value || "").trim().toLowerCase();

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
      // Fall through to comma-separated parsing.
    }

    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const compareOptionSets = (actual, expected) => {
  const actualSet = new Set(parseOptions(actual).map((item) => normalize(item)));
  const expectedSet = new Set(parseOptions(expected).map((item) => normalize(item)));

  if (actualSet.size !== expectedSet.size) return false;
  return [...actualSet].every((item) => expectedSet.has(item));
};

const getAnswerQuestionId = (answer = {}) => answer.questionId || answer.question_id || null;

const getAnswerSelectedOption = (answer = {}) => answer.selectedOption ?? answer.selected_option ?? null;

const getAnswerSelectedOptions = (answer = {}) => {
  if (Array.isArray(answer.selectedOptions)) return answer.selectedOptions;
  if (Array.isArray(answer.selected_options)) return answer.selected_options;
  return [];
};

const getAnswerBoolean = (answer = {}) => {
  if (typeof answer.answerBoolean === "boolean") return answer.answerBoolean;
  if (typeof answer.selectedBoolean === "boolean") return answer.selectedBoolean;
  if (typeof answer.answer_boolean === "boolean") return answer.answer_boolean;
  if (typeof answer.selected_boolean === "boolean") return answer.selected_boolean;
  return null;
};

const getAnswerText = (answer = {}) =>
  answer.answerText ?? answer.selectedText ?? answer.answer_text ?? answer.selected_text ?? null;

const findAnswerForQuestion = (answers = [], question = {}) => {
  const questionIds = [question.id, question.sourceQuestionId, question.source_question_id]
    .filter(Boolean)
    .map((item) => String(item));

  return (answers || []).find((answer) => questionIds.includes(String(getAnswerQuestionId(answer)))) || null;
};

const isAnswerProvided = (answer) => {
  if (!answer) return false;
  if (normalize(getAnswerSelectedOption(answer))) return true;
  if (getAnswerSelectedOptions(answer).length > 0) return true;
  if (typeof getAnswerBoolean(answer) === "boolean") return true;
  return Boolean(normalize(getAnswerText(answer)));
};

const isQuestionCorrect = (question, answer) => {
  if (!isAnswerProvided(answer)) return false;

  const type = String(question?.type || "").toUpperCase();

  if (type === "MCQ" || type === "MCQ_SINGLE" || type === "SINGLE_SELECT") {
    return normalize(getAnswerSelectedOption(answer)) === normalize(question.correctOption);
  }

  if (type === "MCQ_MULTI" || type === "MULTI_SELECT") {
    return compareOptionSets(getAnswerSelectedOptions(answer), question.correctOptions);
  }

  if (type === "TRUE_FALSE" || type === "BOOLEAN") {
    return getAnswerBoolean(answer) === question.correctBoolean;
  }

  return normalize(getAnswerText(answer)) === normalize(question.correctText);
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
  const providedAnswerCount = answers.filter(isAnswerProvided).length;

  let scoredMarks = 0;
  for (const question of questions) {
    const answer = findAnswerForQuestion(answers, question);
    if (isQuestionCorrect(question, answer)) {
      scoredMarks += Number(question?.marks || 0);
    }
  }

  const accuracy = totalMarks > 0 ? (scoredMarks / totalMarks) * 100 : 0;
  const completion = totalQuestions > 0 ? (providedAnswerCount / totalQuestions) * 100 : 0;

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
  compareOptionSets,
  findAnswerForQuestion,
  getAnswerBoolean,
  getAnswerSelectedOption,
  getAnswerSelectedOptions,
  getAnswerText,
  isAnswerProvided,
  isQuestionCorrect,
};
