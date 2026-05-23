const { z } = require("zod");
const mongoose = require("mongoose");
const {
  TEST_TYPES,
  PROCTORING_PRESETS,
  DEFAULT_TEST_CONFIGURATION,
} = require("../../services/test-config.service");

const parseDateInput = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
};

const objectIdSchema = z.string().trim().refine((value) => mongoose.Types.ObjectId.isValid(value), {
  message: "Invalid id format",
});

const testQuestionSchema = z
  .object({
    type: z.enum(["mcq", "true_false", "fill_blank", "paragraph"]),
    question: z.string().trim().min(1),
    options: z.array(z.string().trim()).default([]),
    correctAnswer: z.union([z.string(), z.boolean()]),
    marks: z.number().int().min(1).max(100),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
  })
  .superRefine((question, ctx) => {
    if (question.type === "mcq") {
      if (!Array.isArray(question.options) || question.options.length < 2) {
        ctx.addIssue({ code: "custom", message: "MCQ options must include at least 2 values" });
      }
      if (!question.options.includes(String(question.correctAnswer))) {
        ctx.addIssue({ code: "custom", message: "MCQ correctAnswer must exist in options" });
      }
    }

    if (question.type === "true_false" && typeof question.correctAnswer !== "boolean") {
      ctx.addIssue({ code: "custom", message: "true_false correctAnswer must be boolean" });
    }

    if (["fill_blank", "paragraph"].includes(question.type) && typeof question.correctAnswer !== "string") {
      ctx.addIssue({ code: "custom", message: "Text question correctAnswer must be string" });
    }
  });

const standardDefaults = DEFAULT_TEST_CONFIGURATION.proctoringConfig;

const createAdminTestPayloadSchema = z.object({
  body: z.object({
    name: z.string().trim().min(3),
    description: z.string().trim().max(3000).optional().default(""),
    subject: z.string().trim().min(2),
    durationMins: z.number().int().min(5).max(480),
    totalMarks: z.number().int().min(1),
    attemptsAllowed: z.number().int().min(1).max(10).default(1),
    evaluationRule: z.enum(["LAST_ATTEMPT", "BEST_ATTEMPT"]),
    startsAt: z.string().trim().min(1),
    endsAt: z.string().trim().min(1),
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("department_wise"),
    years: z.array(z.coerce.number().int().min(1).max(4)).min(1).max(4).default([1, 2, 3, 4]),
    departmentId: objectIdSchema.optional().nullable(),
    batchIds: z.array(objectIdSchema).default([]),
    testType: z.enum([TEST_TYPES.STRICT, TEST_TYPES.STANDARD, TEST_TYPES.OPEN]).default(DEFAULT_TEST_CONFIGURATION.testType),
    proctoringPreset: z.enum([
      PROCTORING_PRESETS.STRICT_EXAM,
      PROCTORING_PRESETS.STANDARD_TEST,
      PROCTORING_PRESETS.OPEN_TEST,
    ]).default(DEFAULT_TEST_CONFIGURATION.proctoringPreset),
    questionInputMode: z.enum(["manual", "bulk_json", "question_bank"]).default("manual"),
    questions: z.array(testQuestionSchema).min(1).max(500),
    restrictions: z
      .object({
        enabled: z.boolean().default(standardDefaults.enabled),
        tabSwitch: z.union([z.boolean(), z.enum(["allowed", "monitored"])]).default("monitored"),
        copyPaste: z.union([z.boolean(), z.enum(["allowed", "monitored"])]).default("monitored"),
        rightClick: z.boolean().optional(),
        fullscreen: z.boolean().optional(),
        violationLimit: z.number().int().min(1).max(20).optional(),
        fullscreenRequired: z.boolean().default(standardDefaults.fullscreenRequired),
        windowBlur: z.boolean().default(standardDefaults.windowBlur),
        screenshotDetection: z.boolean().default(standardDefaults.screenshotDetection),
        rightClickDisabled: z.boolean().default(standardDefaults.rightClickDisabled),
        devtoolsDetection: z.boolean().default(standardDefaults.devtoolsDetection),
        violationThreshold: z.number().int().min(1).max(20).default(standardDefaults.violationThreshold),
        autoNextSingle: z.boolean().default(standardDefaults.autoNextSingle),
        paragraphWordLimit: z.number().int().min(10).max(5000).default(standardDefaults.paragraphWordLimit),
      })
      .default({}),
    publishState: z.enum(["DRAFT", "UPCOMING", "PUBLISH"]).default("DRAFT"),
    skipOverlapCheck: z.boolean().default(false),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const createAdminTestSchema = createAdminTestPayloadSchema
  .superRefine((input, ctx) => {
    const startsAt = parseDateInput(input.body.startsAt);
    const endsAt = parseDateInput(input.body.endsAt);
    const nowFloor = new Date();
    nowFloor.setSeconds(0, 0);

    if (!startsAt || !endsAt) {
      ctx.addIssue({ code: "custom", message: "Invalid start/end date-time format" });
      return;
    }

    if (startsAt < nowFloor) {
      ctx.addIssue({ code: "custom", message: "Start date/time cannot be in the past" });
    }

    if (endsAt <= startsAt) {
      ctx.addIssue({ code: "custom", message: "End date/time must be after start date/time" });
    }

    const normalized = input.body.questions.map((q) => `${q.type}:${q.question.trim().toLowerCase()}`);
    const uniqueCount = new Set(normalized).size;
    if (uniqueCount !== normalized.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate questions are not allowed" });
    }

    const marksSum = input.body.questions.reduce((sum, question) => sum + question.marks, 0);
    if (marksSum !== input.body.totalMarks) {
      ctx.addIssue({ code: "custom", message: "totalMarks must equal sum of all question marks" });
    }

    if (input.body.assignmentMethod === "department_wise" && !input.body.departmentId) {
      ctx.addIssue({ code: "custom", message: "Select a department for department-wise assignment" });
    }

    if (input.body.assignmentMethod === "batch_wise") {
      if (!input.body.departmentId) {
        ctx.addIssue({ code: "custom", message: "Select a department before choosing batches" });
      }
      if (!Array.isArray(input.body.batchIds) || input.body.batchIds.length === 0) {
        ctx.addIssue({ code: "custom", message: "Select at least one batch for batch-wise assignment" });
      }
    }

    const threshold = Number(
      input.body.restrictions?.violationThreshold
      ?? input.body.restrictions?.violationLimit
      ?? 0
    );
    if (!Number.isFinite(threshold) || threshold < 1) {
      ctx.addIssue({ code: "custom", message: "Violation threshold must be at least 1" });
    }

    const paragraphWordLimit = Number(input.body.restrictions?.paragraphWordLimit ?? 0);
    if (!Number.isFinite(paragraphWordLimit) || paragraphWordLimit < 10) {
      ctx.addIssue({ code: "custom", message: "Paragraph word limit must be at least 10" });
    }
  });

const updateAdminTestSchema = z.object({
  body: createAdminTestPayloadSchema.shape.body.partial(),
  params: z.object({
    testId: objectIdSchema,
  }),
  query: z.object({}).optional().default({}),
});

const testIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    testId: objectIdSchema,
  }),
  query: z.object({}).optional().default({}),
});

const transitionTestStatusSchema = z.object({
  body: z.object({
    action: z.enum(["SCHEDULE", "GO_LIVE", "COMPLETE", "ARCHIVE"]),
  }),
  params: z.object({
    testId: objectIdSchema,
  }),
  query: z.object({}).optional().default({}),
});

const forceSubmitAttemptSchema = z.object({
  body: z.object({
    submissionId: objectIdSchema,
    reason: z.string().trim().min(3).max(500),
  }),
  params: z.object({
    testId: objectIdSchema,
  }),
  query: z.object({}).optional().default({}),
});

const extendAttemptTimeSchema = z.object({
  body: z.object({
    submissionId: objectIdSchema,
    minutes: z.number().int().min(1).max(120),
  }),
  params: z.object({
    testId: objectIdSchema,
  }),
  query: z.object({}).optional().default({}),
});

const cloneAdminTestSchema = z.object({
  body: z.object({
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("department_wise"),
    years: z.array(z.coerce.number().int().min(1).max(4)).min(1).max(4).optional(),
    departmentId: objectIdSchema.optional().nullable(),
    batchIds: z.array(objectIdSchema).optional().default([]),
  }),
  params: z.object({
    testId: objectIdSchema,
  }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.assignmentMethod === "department_wise" && !input.body.departmentId) {
    ctx.addIssue({ code: "custom", message: "Select a department for department-wise assignment" });
  }
  if (input.body.assignmentMethod === "batch_wise" && (!Array.isArray(input.body.batchIds) || input.body.batchIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "Select at least one batch for batch-wise assignment" });
  }
});

module.exports = {
  createAdminTestSchema,
  updateAdminTestSchema,
  testIdParamSchema,
  transitionTestStatusSchema,
  forceSubmitAttemptSchema,
  extendAttemptTimeSchema,
  cloneAdminTestSchema,
};
