const REVIEW_MODES = Object.freeze({
  SHOW_ALL: "show_all",
  SHOW_SCORE_ONLY: "show_score_only",
  SHOW_AFTER_DEADLINE: "show_after_deadline",
});

const normalizeReviewMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (["show_all", "all", "full", "full_review", "immediate"].includes(normalized)) {
    return REVIEW_MODES.SHOW_ALL;
  }

  if (["show_score_only", "score_only", "score", "hidden", "none"].includes(normalized)) {
    return REVIEW_MODES.SHOW_SCORE_ONLY;
  }

  if (["show_after_deadline", "after_deadline", "after_test", "after_end", "deadline"].includes(normalized)) {
    return REVIEW_MODES.SHOW_AFTER_DEADLINE;
  }

  return REVIEW_MODES.SHOW_AFTER_DEADLINE;
};

const asTestObject = (test) => (test && typeof test === "object" ? test : {});

const resolveReviewMode = (test = {}) => {
  const safeTest = asTestObject(test);
  return normalizeReviewMode(
    safeTest.reviewMode ||
      safeTest.review_mode ||
      safeTest.resultReviewMode ||
      safeTest.result_review_mode ||
      safeTest.answerVisibility ||
      safeTest.answer_visibility
  );
};

const getReviewDeadline = (test = {}) => {
  const safeTest = asTestObject(test);
  return safeTest.endsAt || safeTest.endDate || safeTest.end_date || safeTest.ends_at || null;
};

const hasDeadlinePassed = (deadline) => {
  if (!deadline) {
    return false;
  }

  const deadlineMs = new Date(deadline).getTime();
  return Number.isFinite(deadlineMs) && Date.now() >= deadlineMs;
};

const isTestCompleted = (test = {}) => {
  const safeTest = asTestObject(test);
  const status = String(safeTest.status || safeTest.lifecycleStatus || safeTest.testStatus || "").trim().toUpperCase();
  return ["COMPLETED", "COMPLETE"].includes(status) || Boolean(safeTest.completedAt || safeTest.completed_at);
};

const canRevealCorrectAnswers = (test = {}) => {
  if (isTestCompleted(test)) {
    return true;
  }

  const reviewMode = resolveReviewMode(test);

  if (reviewMode === REVIEW_MODES.SHOW_ALL) {
    return true;
  }

  if (reviewMode === REVIEW_MODES.SHOW_SCORE_ONLY) {
    return false;
  }

  return hasDeadlinePassed(getReviewDeadline(test));
};

const maskCorrectAnswer = (correctAnswer, test = {}) =>
  canRevealCorrectAnswers(test) ? correctAnswer : null;

module.exports = {
  REVIEW_MODES,
  canRevealCorrectAnswers,
  getReviewDeadline,
  isTestCompleted,
  maskCorrectAnswer,
  resolveReviewMode,
};
