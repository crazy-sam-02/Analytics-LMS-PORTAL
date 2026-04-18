import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi, superAdminApi } from "@/services/api";

const STEP_TITLES = [
  "Basic Info",
  "Timing & Attempts",
  "Assignment",
  "Questions",
  "Review & Validation",
  "Proctoring Config",
  "Publish Flow",
];

const emptyQuestion = {
  type: "mcq",
  question: "",
  options: ["", ""],
  correctAnswer: "",
  marks: 1,
  difficulty: "MEDIUM",
  topic: "",
};

const initialState = {
  context: "admin",
  open: false,
  step: 0,
  stepTitles: STEP_TITLES,
  isSubmitting: false,
  errors: {},
  questionRenderLimit: 20,
  form: {
    name: "",
    description: "",
    subject: "",
    durationMins: 60,
    totalMarks: 20,
    startsAt: "",
    endsAt: "",
    attemptsAllowed: 1,
    evaluationRule: "BEST_ATTEMPT",
    skipOverlapCheck: false,
    assignmentMethod: "department_wise",
    departmentId: "",
    departmentIds: [],
    batchIds: [],
    questionInputMode: "manual",
    questions: [{ ...emptyQuestion }],
    shuffleQuestions: false,
    restrictions: {
      fullscreenRequired: true,
      tabSwitch: "monitored",
      copyPaste: "monitored",
      windowBlur: true,
      screenshotDetection: true,
      rightClickDisabled: true,
      devtoolsDetection: true,
      violationThreshold: 3,
    },
    proctoringPreset: "STANDARD_TEST",
    publishState: "DRAFT",
    allColleges: true,
    collegeIds: [],
  },
};

const parseDateTimeLocal = (value) => {
  if (!value || typeof value !== "string") return null;

  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? `${value}:00`
    : value;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
};

const normalizeQuestion = (question) => ({
  type: String(question.type || "mcq").toLowerCase(),
  question: String(question.question || "").trim(),
  options: Array.isArray(question.options)
    ? question.options.map((option) => String(option).trim()).filter(Boolean)
    : [],
  correctAnswer: typeof question.correctAnswer === "string"
    ? question.correctAnswer.trim()
    : question.correctAnswer,
  marks: Number(question.marks || 1),
  difficulty: ["EASY", "MEDIUM", "HARD"].includes(String(question.difficulty || "").toUpperCase())
    ? String(question.difficulty).toUpperCase()
    : "MEDIUM",
  topic: String(question.topic || "").trim(),
});

export const validateCurrentStep = (state) => {
  const { form, step, context } = state;
  const errors = {};

  if (step === 0) {
    if (!form.name.trim()) errors.name = "Test name is required";
    if (!form.subject.trim()) errors.subject = "Subject is required";
    if (!Number.isFinite(Number(form.totalMarks)) || Number(form.totalMarks) < 1) {
      errors.totalMarks = "Total marks must be greater than 0";
    }
    if (!Number.isFinite(Number(form.durationMins)) || Number(form.durationMins) <= 0) {
      errors.durationMins = "Duration must be greater than 0";
    }
  }

  if (step === 1) {
    const start = parseDateTimeLocal(form.startsAt);
    const end = parseDateTimeLocal(form.endsAt);
    const attemptsAllowed = Number(form.attemptsAllowed);
    const nowFloor = new Date();
    nowFloor.setSeconds(0, 0);

    if (!start) errors.startsAt = "Start date/time is required";
    if (!end) errors.endsAt = "End date/time is required";

    if (start && start < nowFloor) {
      errors.startsAt = "Start cannot be in the past";
    }

    if (start && end && end <= start) {
      errors.endsAt = "End must be after start";
    }

    if (!Number.isFinite(attemptsAllowed) || attemptsAllowed < 1 || attemptsAllowed > 10) {
      errors.attemptsAllowed = "Attempts allowed must be between 1 and 10";
    }
  }

  if (step === 2) {
    if (context === "super_admin" && !form.allColleges && (!Array.isArray(form.collegeIds) || form.collegeIds.length === 0)) {
      errors.collegeIds = "Select at least one college";
    }

    if (form.assignmentMethod === "batch_wise" && !form.batchIds.length) {
      errors.batchIds = "Select at least one batch";
    }
  }

  if (step === 3) {
    if (!form.questions.length) {
      errors.questions = "At least one question is required";
      return errors;
    }

    const normalized = form.questions.map(normalizeQuestion);
    const duplicateGuard = normalized.map((question) => `${question.type}:${question.question.toLowerCase()}`);
    if (new Set(duplicateGuard).size !== duplicateGuard.length) {
      errors.questions = "Duplicate questions are not allowed";
    }

    const invalidQuestion = normalized.some((question) => !question.question);
    if (invalidQuestion) {
      errors.questions = "Every question must have text";
    }

    const invalidMcq = normalized.some((question) => {
      if (question.type !== "mcq") return false;
      return question.options.length < 2 || !question.options.includes(String(question.correctAnswer));
    });

    if (invalidMcq) {
      errors.questions = "MCQ requires at least 2 options and valid correct answer";
    }

    const invalidBoolean = normalized.some((question) => {
      if (question.type !== "true_false") return false;
      return typeof question.correctAnswer !== "boolean";
    });

    if (invalidBoolean) {
      errors.questions = "True/False questions require boolean correct answer";
    }

    const invalidTextQuestion = normalized.some((question) => {
      if (!["fill_blank", "paragraph"].includes(question.type)) return false;
      return typeof question.correctAnswer !== "string" || !question.correctAnswer;
    });

    if (invalidTextQuestion) {
      errors.questions = "Fill blank/paragraph questions require a text answer";
    }

    const marksSum = normalized.reduce((total, question) => total + Number(question.marks || 0), 0);
    if (marksSum !== Number(form.totalMarks)) {
      errors.questions = "Sum of question marks must equal total marks";
    }
  }

  if (step === 4) {
    const normalized = form.questions.map(normalizeQuestion);

    if (!normalized.length) {
      errors.review = "No questions added.";
      return errors;
    }

    if (!Number.isFinite(Number(form.totalMarks)) || Number(form.totalMarks) <= 0) {
      errors.review = "Total marks must be greater than 0.";
      return errors;
    }

    const invalidIndexes = normalized
      .map((question, idx) => ({ question, idx }))
      .filter(({ question }) => {
        if (!question.question || Number(question.marks || 0) <= 0) {
          return true;
        }

        if (question.type === "mcq") {
          return question.options.length < 2 || !question.options.includes(String(question.correctAnswer));
        }

        if (question.type === "true_false") {
          return typeof question.correctAnswer !== "boolean";
        }

        return typeof question.correctAnswer !== "string" || !String(question.correctAnswer).trim();
      })
      .map(({ idx }) => idx + 1);

    if (invalidIndexes.length > 0) {
      errors.review = `Fix Question ${invalidIndexes.join(", ")}`;
      return errors;
    }
  }

  if (step === 5) {
    if (!Number.isFinite(Number(form.restrictions.violationThreshold)) || Number(form.restrictions.violationThreshold) < 1) {
      errors.violationThreshold = "Violation threshold must be at least 1";
    }
  }

  return errors;
};

export const submitTestCreation = createAsyncThunk(
  "testCreation/submit",
  async (_, { getState, rejectWithValue }) => {
    const state = getState().testCreation;
    const { form } = state;

    if (!form.questions.length) {
      return rejectWithValue("Cannot submit without questions");
    }

    const startsAt = parseDateTimeLocal(form.startsAt);
    const endsAt = parseDateTimeLocal(form.endsAt);

    if (!startsAt || !endsAt) {
      return rejectWithValue("Invalid start/end date values");
    }

    const payload = {
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      subject: form.subject.trim(),
      durationMins: Number(form.durationMins),
      totalMarks: Number(form.totalMarks),
      attemptsAllowed: Math.max(1, Math.min(10, Number(form.attemptsAllowed) || 1)),
      skipOverlapCheck: form.publishState === "DRAFT" ? true : Boolean(form.skipOverlapCheck),
      assignmentMethod: form.assignmentMethod,
      departmentId: form.departmentId?.trim() ? form.departmentId.trim() : null,
      batchIds: Array.isArray(form.batchIds) ? form.batchIds.filter(Boolean) : [],
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      restrictions: {
        fullscreenRequired: Boolean(form.restrictions.fullscreenRequired),
        tabSwitch: ["allowed", "monitored"].includes(form.restrictions.tabSwitch) ? form.restrictions.tabSwitch : "monitored",
        copyPaste: ["allowed", "monitored"].includes(form.restrictions.copyPaste) ? form.restrictions.copyPaste : "monitored",
        windowBlur: Boolean(form.restrictions.windowBlur),
        screenshotDetection: Boolean(form.restrictions.screenshotDetection),
        rightClickDisabled: Boolean(form.restrictions.rightClickDisabled),
        devtoolsDetection: Boolean(form.restrictions.devtoolsDetection),
        violationThreshold: Math.max(1, Number(form.restrictions.violationThreshold) || 1),
      },
      questions: form.questions.map((question) => normalizeQuestion(question)),
    };

    try {
      if (state.context === "super_admin") {
        const collegeIds = form.allColleges ? [] : (Array.isArray(form.collegeIds) ? form.collegeIds.filter(Boolean) : []);

        const superPayload = {
          title: payload.name,
          subject: payload.subject,
          description: payload.description || "Created by super admin",
          durationMins: payload.durationMins,
          totalMarks: payload.totalMarks,
          attemptsAllowed: payload.attemptsAllowed,
          evaluationRule: payload.evaluationRule,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          collegeIds,
          allColleges: Boolean(form.allColleges),
          assignmentMethod: form.assignmentMethod || "department_wise",
          batchIds: Array.isArray(form.batchIds) ? form.batchIds.filter(Boolean) : [],
          departmentIds: Array.isArray(form.departmentIds) ? form.departmentIds.filter(Boolean) : [],
          questions: payload.questions.map((question) => {
            const typeMap = {
              mcq: "MCQ",
              true_false: "TRUE_FALSE",
              fill_blank: "FILL_BLANK",
              paragraph: "PARAGRAPH",
            };
            const mappedType = typeMap[question.type] || "MCQ";

            return {
              prompt: question.question,
              type: mappedType,
              options: mappedType === "MCQ" ? question.options : [],
              correctOption: mappedType === "MCQ" ? String(question.correctAnswer || "") : null,
              correctBoolean: mappedType === "TRUE_FALSE" ? Boolean(question.correctAnswer) : null,
              correctText: ["FILL_BLANK", "PARAGRAPH"].includes(mappedType) ? String(question.correctAnswer || "") : null,
              marks: question.marks,
            };
          }),
        };

        return await superAdminApi.createGlobalTest(superPayload);
      }

      return await adminApi.createTest(payload);
    } catch (error) {
      return rejectWithValue(error.message || "Failed to create test");
    }
  },
  {
    condition: (_, { getState }) => {
      const { isSubmitting } = getState().testCreation;
      return !isSubmitting;
    },
  }
);

const testCreationSlice = createSlice({
  name: "testCreation",
  initialState,
  reducers: {
    openTestCreationDialog: (state) => {
      state.open = true;
    },
    closeTestCreationDialog: (state) => {
      state.open = false;
      state.step = 0;
      state.errors = {};
      state.questionRenderLimit = 20;
    },
    hydrateTestCreationDraft: (state, action) => {
      state.form = {
        ...state.form,
        ...action.payload,
      };
    },
    setDialogOpenState: (state, action) => {
      state.open = Boolean(action.payload);
      if (!state.open) {
        state.step = 0;
        state.errors = {};
        state.questionRenderLimit = 20;
      }
    },
    setTestCreationStep: (state, action) => {
      state.step = Math.max(0, Math.min(state.stepTitles.length - 1, Number(action.payload)));
    },
    setTestCreationErrors: (state, action) => {
      state.errors = action.payload || {};
    },
    clearTestCreationErrors: (state) => {
      state.errors = {};
    },
    updateTestCreationField: (state, action) => {
      const { key, value } = action.payload;
      state.form[key] = value;
    },
    updateRestrictionsField: (state, action) => {
      const { key, value } = action.payload;
      state.form.restrictions[key] = value;
    },
    toggleBatchId: (state, action) => {
      const batchId = action.payload;
      if (state.form.batchIds.includes(batchId)) {
        state.form.batchIds = state.form.batchIds.filter((id) => id !== batchId);
      } else {
        state.form.batchIds.push(batchId);
      }
    },
    clearBatches: (state) => {
      state.form.batchIds = [];
    },
    setTestCreationContext: (state, action) => {
      state.context = action.payload === "super_admin" ? "super_admin" : "admin";
    },
    setQuestionInputMode: (state, action) => {
      state.form.questionInputMode = action.payload;
    },
    addQuestionsFromBank: (state, action) => {
      const incoming = Array.isArray(action.payload) ? action.payload : [];
      const mapped = incoming.map((item) => ({
        type: String(item.type || "mcq").toLowerCase(),
        question: String(item.prompt || item.question || "").trim(),
        options: Array.isArray(item.options) ? item.options : [],
        correctAnswer:
          item.correctOption ??
          item.correctText ??
          (typeof item.correctBoolean === "boolean" ? item.correctBoolean : ""),
        marks: Number(item.marks || 1),
        difficulty: ["EASY", "MEDIUM", "HARD"].includes(String(item.difficulty || "").toUpperCase())
          ? String(item.difficulty).toUpperCase()
          : "MEDIUM",
        topic: String(item.topic || ""),
      }));

      const keyOf = (question) => `${String(question.type || "").toLowerCase()}:${String(question.question || "").trim().toLowerCase()}`;
      const existingKeys = new Set(state.form.questions.map((item) => keyOf(item)));
      const deduped = mapped.filter((item) => item.question && !existingKeys.has(keyOf(item)));
      if (deduped.length > 0) {
        state.form.questions.push(...deduped);
      }
      state.form.questionInputMode = "question_bank";
    },
    addQuestionRow: (state) => {
      state.form.questions.push({ ...emptyQuestion });
    },
    updateQuestionRow: (state, action) => {
      const { index, patch } = action.payload;
      if (!state.form.questions[index]) return;
      state.form.questions[index] = {
        ...state.form.questions[index],
        ...patch,
      };
    },
    removeQuestionRow: (state, action) => {
      const index = action.payload;
      state.form.questions = state.form.questions.filter((_, i) => i !== index);
      if (!state.form.questions.length) {
        state.form.questions = [{ ...emptyQuestion }];
      }
    },
    replaceQuestionsFromBulk: (state, action) => {
      state.form.questions = action.payload;
      state.form.questionInputMode = "bulk_json";
      state.questionRenderLimit = 20;
    },
    increaseQuestionRenderLimit: (state) => {
      state.questionRenderLimit += 20;
    },
    goToNextCreationStep: (state) => {
      state.step = Math.min(state.step + 1, state.stepTitles.length - 1);
    },
    goToPreviousCreationStep: (state) => {
      state.step = Math.max(state.step - 1, 0);
    },
    resetTestCreationState: () => ({ ...initialState, form: { ...initialState.form, questions: [{ ...emptyQuestion }] } }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitTestCreation.pending, (state) => {
        state.isSubmitting = true;
      })
      .addCase(submitTestCreation.fulfilled, (state) => {
        state.isSubmitting = false;
        state.open = false;
        state.step = 0;
        state.errors = {};
        state.questionRenderLimit = 20;
        state.form = {
          ...initialState.form,
          questions: [{ ...emptyQuestion }],
        };
      })
      .addCase(submitTestCreation.rejected, (state) => {
        state.isSubmitting = false;
      });
  },
});

export const {
  openTestCreationDialog,
  closeTestCreationDialog,
  hydrateTestCreationDraft,
  setDialogOpenState,
  setTestCreationStep,
  setTestCreationErrors,
  clearTestCreationErrors,
  updateTestCreationField,
  updateRestrictionsField,
  toggleBatchId,
  clearBatches,
  setTestCreationContext,
  setQuestionInputMode,
  addQuestionsFromBank,
  addQuestionRow,
  updateQuestionRow,
  removeQuestionRow,
  replaceQuestionsFromBulk,
  increaseQuestionRenderLimit,
  goToNextCreationStep,
  goToPreviousCreationStep,
  resetTestCreationState,
} = testCreationSlice.actions;

export default testCreationSlice.reducer;
