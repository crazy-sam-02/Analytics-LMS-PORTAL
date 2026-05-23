import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { adminApi, superAdminApi } from "@/services/api";
import {
  DEFAULT_PROCTORING_PRESET,
  DEFAULT_TEST_TYPE,
  derivePresetFromTestType,
  deriveTestTypeFromPreset,
  normalizeProctoringPreset,
  normalizeRestrictions,
  normalizeTestType,
  resolveIncomingTestConfig,
} from "@/lib/testConfig";

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

const createDefaultForm = () => ({
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
  years: [1, 2, 3, 4],
  departmentId: "",
  departmentIds: [],
  batchIds: [],
  questionInputMode: "manual",
  questions: [{ ...emptyQuestion }],
  shuffleQuestions: false,
  restrictions: normalizeRestrictions(),
  testType: DEFAULT_TEST_TYPE,
  proctoringPreset: DEFAULT_PROCTORING_PRESET,
  publishState: "DRAFT",
  allColleges: true,
  collegeIds: [],
});

const initialState = {
  context: "admin",
  mode: "create",
  editingTestId: null,
  open: false,
  step: 0,
  stepTitles: STEP_TITLES,
  isSubmitting: false,
  errors: {},
  questionRenderLimit: 20,
  form: createDefaultForm(),
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

const toDateTimeLocal = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const mapQuestionToForm = (question) => {
  const typeMap = {
    MCQ: "mcq",
    TRUE_FALSE: "true_false",
    FILL_BLANK: "fill_blank",
    PARAGRAPH: "paragraph",
  };
  const resolvedType = typeMap[String(question?.type || "MCQ").toUpperCase()] || "mcq";

  return {
    type: resolvedType,
    question: String(question?.prompt || question?.question || "").trim(),
    options: Array.isArray(question?.options) ? question.options : [],
    correctAnswer:
      resolvedType === "mcq"
        ? String(question?.correctOption || "")
        : resolvedType === "true_false"
          ? Boolean(question?.correctBoolean)
          : String(question?.correctText || ""),
    marks: Number(question?.marks || 1),
    difficulty: ["EASY", "MEDIUM", "HARD"].includes(String(question?.difficulty || "").toUpperCase())
      ? String(question.difficulty).toUpperCase()
      : "MEDIUM",
    topic: String(question?.topic || "").trim(),
  };
};

const deriveAssignmentMethod = (test) => {
  const explicit = String(test?.assignmentMethod || "").trim().toLowerCase();
  if (["everyone", "department_wise", "batch_wise"].includes(explicit)) {
    return explicit;
  }

  if (test?.departmentId) {
    return "department_wise";
  }

  if (Array.isArray(test?.batchAssignments) && test.batchAssignments.length > 0) {
    return "batch_wise";
  }

  if (test?.batchId) {
    return "batch_wise";
  }

  return "department_wise";
};

const buildFormFromTest = (test) => {
  const status = String(test?.status || "DRAFT").toUpperCase();
  const publishState = status === "LIVE" || status === "PUBLISHED"
    ? "PUBLISH"
    : status === "SCHEDULED" || status === "UPCOMING"
      ? "UPCOMING"
      : "DRAFT";
  const resolvedAssignmentMethod = deriveAssignmentMethod(test);
  const resolvedConfig = resolveIncomingTestConfig(test || {});
  const batchAssignments = Array.isArray(test?.batchAssignments) ? test.batchAssignments : [];
  const batchIds = batchAssignments.length > 0
    ? batchAssignments.map((assignment) => assignment?.batchId || assignment?.batch?.id).filter(Boolean)
    : (test?.batchId ? [test.batchId] : []);
  const departmentIdsFromBatches = [...new Set(
    batchAssignments
      .map((assignment) => assignment?.batch?.departmentId)
      .filter(Boolean)
  )];
  const assignedDepartmentIds = Array.isArray(test?.assignedTo)
    ? test.assignedTo.filter(Boolean)
    : [];
  const departmentIds = resolvedAssignmentMethod === "department_wise"
    ? [...new Set([test?.departmentId, ...assignedDepartmentIds, ...departmentIdsFromBatches].filter(Boolean))]
    : departmentIdsFromBatches;
  const collegeId = test?.collegeId || test?.college?.id || null;

  return {
    ...createDefaultForm(),
    name: String(test?.title || "").trim(),
    description: String(test?.description || "").trim(),
    subject: String(test?.subject || "").trim(),
    durationMins: Number(test?.durationMins || 60),
    totalMarks: Number(test?.totalMarks || 20),
    startsAt: toDateTimeLocal(test?.startsAt),
    endsAt: toDateTimeLocal(test?.endsAt),
    attemptsAllowed: Math.max(1, Math.min(10, Number(test?.attemptsAllowed || 1))),
    evaluationRule: String(test?.evaluationRule || "BEST_ATTEMPT"),
    assignmentMethod: resolvedAssignmentMethod,
    years: Array.isArray(test?.years) && test.years.length > 0
      ? test.years.map((year) => Number(year)).filter((year) => year >= 1 && year <= 4)
      : [1, 2, 3, 4],
    departmentId: String(test?.departmentId || ""),
    departmentIds,
    batchIds,
    questions: Array.isArray(test?.questions) && test.questions.length > 0
      ? test.questions
          .slice()
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
          .map(mapQuestionToForm)
      : [{ ...emptyQuestion }],
    restrictions: resolvedConfig.restrictions,
    testType: resolvedConfig.testType,
    proctoringPreset: resolvedConfig.proctoringPreset,
    publishState,
    allColleges: false,
    collegeIds: collegeId ? [collegeId] : [],
  };
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
  const { form, step, context, mode } = state;
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

    if (mode !== "edit" && start && start < nowFloor) {
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
    if (!Array.isArray(form.years) || form.years.length === 0) {
      errors.years = "Select at least one student year";
    }

    if (context === "super_admin" && !form.allColleges && (!Array.isArray(form.collegeIds) || form.collegeIds.length === 0)) {
      errors.collegeIds = "Select at least one college";
    }

    if (form.assignmentMethod === "department_wise") {
      if (context === "super_admin") {
        if (!Array.isArray(form.departmentIds) || form.departmentIds.length === 0) {
          errors.departmentIds = "Select at least one department";
        }
      } else if (!String(form.departmentId || "").trim()) {
        errors.departmentId = "Select a department";
      }
    }

    if (form.assignmentMethod === "batch_wise") {
      if (context !== "super_admin" && !String(form.departmentId || "").trim()) {
        errors.departmentId = "Select a department before choosing batches";
      }
      if (!form.batchIds.length) {
        errors.batchIds = "Select at least one batch";
      }
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

    if (normalized.some((question) => !question.question)) {
      errors.questions = "Every question must have text";
    }

    if (normalized.some((question) => {
      if (question.type !== "mcq") return false;
      return question.options.length < 2 || !question.options.includes(String(question.correctAnswer));
    })) {
      errors.questions = "MCQ requires at least 2 options and valid correct answer";
    }

    if (normalized.some((question) => question.type === "true_false" && typeof question.correctAnswer !== "boolean")) {
      errors.questions = "True/False questions require boolean correct answer";
    }

    if (normalized.some((question) => {
      if (!["fill_blank", "paragraph"].includes(question.type)) return false;
      return typeof question.correctAnswer !== "string" || !question.correctAnswer;
    })) {
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

    if (!Number.isFinite(Number(form.restrictions.paragraphWordLimit)) || Number(form.restrictions.paragraphWordLimit) < 10) {
      errors.paragraphWordLimit = "Paragraph word limit must be at least 10";
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

    const normalizedRestrictions = normalizeRestrictions(form.restrictions, {
      fallbackPreset: normalizeProctoringPreset(
        form.proctoringPreset,
        derivePresetFromTestType(form.testType)
      ),
    });

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
      years: Array.isArray(form.years) ? [...new Set(form.years.map(Number).filter((year) => year >= 1 && year <= 4))] : [],
      departmentId: form.departmentId?.trim() ? form.departmentId.trim() : null,
      batchIds: Array.isArray(form.batchIds) ? form.batchIds.filter(Boolean) : [],
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      testType: normalizeTestType(form.testType, deriveTestTypeFromPreset(form.proctoringPreset)),
      proctoringPreset: normalizeProctoringPreset(
        form.proctoringPreset,
        deriveTestTypeFromPreset(form.proctoringPreset)
      ),
      restrictions: normalizedRestrictions,
      questions: form.questions.map((question) => normalizeQuestion(question)),
    };

    try {
      if (state.context === "super_admin") {
        const isSuperEditMode = state.mode === "edit" && Boolean(state.editingTestId);
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
          years: payload.years,
          batchIds: form.assignmentMethod === "batch_wise"
            ? (Array.isArray(form.batchIds) ? form.batchIds.filter(Boolean) : [])
            : [],
          departmentIds: form.assignmentMethod === "department_wise"
            ? Array.isArray(form.departmentIds)
              ? [...new Set(form.departmentIds.filter(Boolean))]
              : []
            : [],
          testType: payload.testType,
          proctoringPreset: payload.proctoringPreset,
          restrictions: payload.restrictions,
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

        if (isSuperEditMode) {
          return await superAdminApi.updateTest(state.editingTestId, superPayload);
        }

        return await superAdminApi.createGlobalTest(superPayload);
      }

      if (state.mode === "edit" && state.editingTestId) {
        return await adminApi.updateTest(state.editingTestId, payload);
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

const resetTransientDialogState = (state) => {
  state.step = 0;
  state.errors = {};
  state.questionRenderLimit = 20;
};

const resetToCreateMode = (state) => {
  state.mode = "create";
  state.editingTestId = null;
  state.form = createDefaultForm();
  resetTransientDialogState(state);
};

const testCreationSlice = createSlice({
  name: "testCreation",
  initialState,
  reducers: {
    openTestCreationDialog: (state) => {
      state.open = true;
      resetToCreateMode(state);
    },
    openTestEditDialog: (state, action) => {
      const { test } = action.payload || {};
      state.mode = "edit";
      state.editingTestId = test?.id || null;
      state.form = buildFormFromTest(test || {});
      state.open = true;
      resetTransientDialogState(state);
    },
    closeTestCreationDialog: (state) => {
      state.open = false;
      resetToCreateMode(state);
    },
    hydrateTestCreationDraft: (state, action) => {
      const patch = action.payload || {};
      state.form = {
        ...state.form,
        ...patch,
        restrictions: patch.restrictions
          ? normalizeRestrictions(patch.restrictions, {
              fallbackPreset: normalizeProctoringPreset(
                patch.proctoringPreset || state.form.proctoringPreset,
                derivePresetFromTestType(patch.testType || state.form.testType)
              ),
            })
          : state.form.restrictions,
        questions: Array.isArray(patch.questions) && patch.questions.length > 0
          ? patch.questions
          : state.form.questions,
      };
    },
    setDialogOpenState: (state, action) => {
      state.open = Boolean(action.payload);
      if (!state.open) {
        resetToCreateMode(state);
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

      if (key === "testType") {
        state.form.testType = normalizeTestType(value);
        state.form.proctoringPreset = derivePresetFromTestType(state.form.testType);
      }

      if (key === "proctoringPreset") {
        state.form.proctoringPreset = normalizeProctoringPreset(value);
        state.form.testType = deriveTestTypeFromPreset(state.form.proctoringPreset);
      }

      if (key === "allColleges" && value) {
        state.form.collegeIds = [];
      }
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
    resetTestCreationState: () => ({
      ...initialState,
      form: createDefaultForm(),
    }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitTestCreation.pending, (state) => {
        state.isSubmitting = true;
      })
      .addCase(submitTestCreation.fulfilled, (state) => {
        state.isSubmitting = false;
        state.open = false;
        resetToCreateMode(state);
      })
      .addCase(submitTestCreation.rejected, (state) => {
        state.isSubmitting = false;
      });
  },
});

export const {
  openTestCreationDialog,
  openTestEditDialog,
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
