const { z } = require("zod");

const paramsWithTestId = z.object({
  testId: z.string().min(1),
});

const saveAnswerSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    questionId: z.string().min(1),
    selectedOption: z.string().optional().nullable(),
    answerText: z.string().optional().nullable(),
    answerBoolean: z.boolean().optional().nullable(),
    markedForReview: z.boolean().optional(),
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const saveAnswerCompatSchema = z.object({
  body: z.object({
    testId: z.string().min(1),
    submissionId: z.string().min(1),
    questionId: z.string().min(1),
    selectedOption: z.string().optional().nullable(),
    answerText: z.string().optional().nullable(),
    answerBoolean: z.boolean().optional().nullable(),
    markedForReview: z.boolean().optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const submitSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const submitCompatSchema = z.object({
  body: z.object({
    testId: z.string().min(1),
    submissionId: z.string().min(1),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const violationSchema = z.object({
  body: z.object({
    submissionId: z.string().min(1),
    type: z.enum(["TAB_SWITCH", "COPY_PASTE", "RIGHT_CLICK", "WINDOW_BLUR"]),
    metadata: z.record(z.any()).optional(),
  }),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const testIdOnlySchema = z.object({
  body: z.object({}).optional().default({}),
  params: paramsWithTestId,
  query: z.object({}).optional().default({}),
});

const attemptIdOnlySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    attemptId: z.string().min(1),
  }),
  query: z.object({}).optional().default({}),
});

module.exports = {
  saveAnswerSchema,
  saveAnswerCompatSchema,
  submitSchema,
  submitCompatSchema,
  violationSchema,
  testIdOnlySchema,
  attemptIdOnlySchema,
};
