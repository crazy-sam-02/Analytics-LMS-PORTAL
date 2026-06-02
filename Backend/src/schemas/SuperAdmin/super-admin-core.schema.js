const { z } = require("zod");
const { validatePasswordPolicy } = require("../../services/super-admin.service");
const {
  TEST_TYPES,
  PROCTORING_PRESETS,
  DEFAULT_TEST_CONFIGURATION,
} = require("../../services/test-config.service");

const idSchema = z.string().trim().refine(
  (value) =>
    z.string().cuid().safeParse(value).success ||
    z.string().uuid().safeParse(value).success ||
    /^[a-fA-F0-9]{24}$/.test(value),
  "Invalid identifier"
);

const optionalNullableIdSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  idSchema.optional().nullable()
);

const paginationQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    year: z.coerce.number().int().min(1).max(4).optional(),
    collegeId: idSchema.optional(),
    departmentId: idSchema.optional(),
    batchId: idSchema.optional(),
    studentId: idSchema.optional(),
    status: z.string().optional(),
  }).optional().default({}),
});

const createCollegeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(3),
    code: z.string().trim().min(2).max(16),
    location: z.string().trim().min(2).max(120).optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateCollegeSchema = z.object({
  body: createCollegeSchema.shape.body.partial().extend({
    isActive: z.boolean().optional(),
    confirmationText: z.string().trim().optional(),
    collegeAdminId: optionalNullableIdSchema,
  }),
  params: z.object({ collegeId: idSchema }),
  query: z.object({}).optional().default({}),
});

const createDepartmentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    collegeId: idSchema,
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateDepartmentSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
  }),
  params: z.object({
    departmentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const deleteDepartmentSchema = z.object({
  body: z.object({
    confirmationText: z.string().trim().min(1),
  }),
  params: z.object({
    departmentId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const bulkImportDepartmentsSchema = z.object({
  body: z.object({
    csvData: z.string().trim().min(1),
    defaultCollegeId: idSchema.optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const createAdminSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    employeeId: z.string().trim().min(3),
    password: z.string().min(8),
    role: z.enum(["ADMIN", "COLLEGE_ADMIN"]).default("ADMIN"),
    collegeId: idSchema,
    departmentId: optionalNullableIdSchema,
    accessProfile: z.enum(["VIEW_ONLY", "EDITOR"]).default("EDITOR"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.role === "ADMIN" && !input.body.departmentId) {
    ctx.addIssue({
      code: "custom",
      message: "departmentId is required for ADMIN",
    });
  }
});

const updateAdminSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).optional(),
    role: z.enum(["ADMIN", "COLLEGE_ADMIN"]).optional(),
    collegeId: idSchema.optional(),
    departmentId: optionalNullableIdSchema,
    isActive: z.boolean().optional(),
    accessProfile: z.enum(["VIEW_ONLY", "EDITOR"]).optional(),
  }),
  params: z.object({ adminId: idSchema }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.role === "ADMIN" && input.body.departmentId === null) {
    ctx.addIssue({
      code: "custom",
      message: "departmentId cannot be null for ADMIN",
    });
  }
});

const resetAdminPasswordSchema = z.object({
  body: z.object({
    password: z.string().min(8),
  }),
  params: z.object({ adminId: idSchema }),
  query: z.object({}).optional().default({}),
});

const deactivateAdminSchema = z.object({
  body: z.object({
    confirmationText: z.string().trim().min(1),
  }),
  params: z.object({ adminId: idSchema }),
  query: z.object({}).optional().default({}),
});

const bulkImportAdminsSchema = z.object({
  body: z.object({
    csvData: z.string().trim().min(1),
    defaultCollegeId: idSchema.optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const createStudentGlobalSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2),
    email: z.string().trim().email(),
    enrollNumber: z.string().trim().min(3),
    year: z.coerce.number().int().min(1).max(4),
    collegeId: idSchema,
    departmentId: idSchema.optional(),
    department: z.string().trim().min(2).optional(),
    batchId: optionalNullableIdSchema,
  }).superRefine((payload, ctx) => {
    if (!payload.departmentId && !payload.department) {
      ctx.addIssue({
        code: "custom",
        message: "Either departmentId or department is required",
      });
    }
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superStudentBulkImportSchema = z.object({
  body: z.object({
    csvData: z.string().trim().min(1),
    collegeId: idSchema,
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superStudentBulkImportJobParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    jobId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const assignTestToBatchesSchema = z.object({
  body: z.object({
    testId: idSchema,
    batchIds: z.array(idSchema).min(1),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const createBatchGlobalSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    year: z.number().int().min(2000).max(2100),
    collegeId: idSchema,
    departmentId: idSchema.optional(),
    departmentIds: z.array(idSchema).optional().default([]),
    isGlobal: z.boolean().optional().default(false),
    studentIds: z.array(idSchema).optional().default([]),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.isGlobal) {
    if (!Array.isArray(input.body.departmentIds) || input.body.departmentIds.length < 2) {
      ctx.addIssue({ code: "custom", message: "Select at least two departments for a global batch" });
    }
    return;
  }

  if (!input.body.departmentId) {
    ctx.addIssue({ code: "custom", message: "departmentId is required for a department batch" });
  }
});

const updateBatchGlobalSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    departmentId: idSchema.optional(),
    departmentIds: z.array(idSchema).optional(),
    isGlobal: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  }),
  params: z.object({
    batchId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const deleteBatchGlobalSchema = z.object({
  body: z.object({
    confirmationText: z.string().trim().min(1),
  }),
  params: z.object({
    batchId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const assignStudentsToGlobalBatchSchema = z.object({
  body: z.object({
    studentIds: z.array(idSchema).min(1),
  }),
  params: z.object({
    batchId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const toggleStudentStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
    confirmationText: z.string().trim().optional(),
  }),
  params: z.object({ studentId: idSchema }),
  query: z.object({}).optional().default({}),
});

const promoteStudentsYearGlobalSchema = z.object({
  body: z.object({
    collegeId: idSchema,
    confirmationText: z.string().trim().min(1),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const resetStudentPasswordSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({ studentId: idSchema }),
  query: z.object({}).optional().default({}),
});

const superAdminTestQuestionSchema = z.object({
  prompt: z.string().trim().min(1),
  type: z.enum(["MCQ", "TRUE_FALSE", "FILL_BLANK", "PARAGRAPH"]),
  options: z.array(z.string()).optional().default([]),
  correctOption: z.string().optional().nullable(),
  correctBoolean: z.boolean().optional().nullable(),
  correctText: z.string().optional().nullable(),
  marks: z.number().int().min(1).default(1),
});

const standardProctoringDefaults = DEFAULT_TEST_CONFIGURATION.proctoringConfig;

const superAdminRestrictionsSchema = z.object({
  enabled: z.boolean().default(standardProctoringDefaults.enabled),
  tabSwitch: z.union([z.boolean(), z.enum(["allowed", "monitored"])]).default(standardProctoringDefaults.tabSwitch),
  copyPaste: z.union([z.boolean(), z.enum(["allowed", "monitored"])]).default(standardProctoringDefaults.copyPaste),
  fullscreenRequired: z.boolean().default(standardProctoringDefaults.fullscreenRequired),
  windowBlur: z.boolean().default(standardProctoringDefaults.windowBlur),
  screenshotDetection: z.boolean().default(standardProctoringDefaults.screenshotDetection),
  rightClickDisabled: z.boolean().default(standardProctoringDefaults.rightClickDisabled),
  devtoolsDetection: z.boolean().default(standardProctoringDefaults.devtoolsDetection),
  violationThreshold: z.number().int().min(1).max(20).default(standardProctoringDefaults.violationThreshold),
  autoNextSingle: z.boolean().default(standardProctoringDefaults.autoNextSingle),
  paragraphWordLimit: z.number().int().min(10).max(5000).default(standardProctoringDefaults.paragraphWordLimit),
});

const createGlobalTestSchema = z.object({
  body: z.object({
    title: z.string().trim().min(3),
    subject: z.string().trim().min(2),
    description: z.string().trim().optional(),
    durationMins: z.number().int().min(5).max(480),
    totalMarks: z.number().int().min(1),
    attemptsAllowed: z.number().int().min(1).max(10).default(1),
    evaluationRule: z.enum(["LAST_ATTEMPT", "BEST_ATTEMPT"]).default("BEST_ATTEMPT"),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    allColleges: z.boolean().default(false),
    collegeIds: z.array(idSchema).optional().default([]),
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("department_wise"),
    years: z.array(z.coerce.number().int().min(1).max(4)).min(1).max(4).default([1, 2, 3, 4]),
    departmentIds: z.array(idSchema).optional().default([]),
    batchIds: z.array(idSchema).optional().default([]),
    testType: z.enum([TEST_TYPES.STRICT, TEST_TYPES.STANDARD, TEST_TYPES.OPEN]).default(DEFAULT_TEST_CONFIGURATION.testType),
    proctoringPreset: z.enum([
      PROCTORING_PRESETS.STRICT_EXAM,
      PROCTORING_PRESETS.STANDARD_TEST,
      PROCTORING_PRESETS.OPEN_TEST,
    ]).default(DEFAULT_TEST_CONFIGURATION.proctoringPreset),
    restrictions: superAdminRestrictionsSchema.default({}),
    questions: z.array(superAdminTestQuestionSchema).min(1),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (!input.body.allColleges && (!Array.isArray(input.body.collegeIds) || input.body.collegeIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one college must be targeted" });
  }

  if (input.body.assignmentMethod === "batch_wise" && (!Array.isArray(input.body.batchIds) || input.body.batchIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one batch must be selected for batch-wise assignment" });
  }

  if (Number(input.body?.restrictions?.paragraphWordLimit || 0) < 10) {
    ctx.addIssue({ code: "custom", message: "Paragraph word limit must be at least 10" });
  }
});

const testIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    testId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const updateGlobalTestSchema = z.object({
  body: z.object({
    title: z.string().trim().min(3),
    subject: z.string().trim().min(2),
    description: z.string().trim().optional(),
    durationMins: z.number().int().min(5).max(480),
    totalMarks: z.number().int().min(1),
    attemptsAllowed: z.number().int().min(1).max(10).default(1),
    evaluationRule: z.enum(["LAST_ATTEMPT", "BEST_ATTEMPT"]).default("BEST_ATTEMPT"),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    allColleges: z.boolean().default(false),
    collegeIds: z.array(idSchema).optional().default([]),
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("batch_wise"),
    years: z.array(z.coerce.number().int().min(1).max(4)).min(1).max(4).default([1, 2, 3, 4]),
    departmentIds: z.array(idSchema).optional().default([]),
    batchIds: z.array(idSchema).optional().default([]),
    testType: z.enum([TEST_TYPES.STRICT, TEST_TYPES.STANDARD, TEST_TYPES.OPEN]).default(DEFAULT_TEST_CONFIGURATION.testType),
    proctoringPreset: z.enum([
      PROCTORING_PRESETS.STRICT_EXAM,
      PROCTORING_PRESETS.STANDARD_TEST,
      PROCTORING_PRESETS.OPEN_TEST,
    ]).default(DEFAULT_TEST_CONFIGURATION.proctoringPreset),
    restrictions: superAdminRestrictionsSchema.default({}),
    questions: z.array(superAdminTestQuestionSchema).min(1),
  }),
  params: z.object({
    testId: idSchema,
  }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.assignmentMethod === "department_wise" && (!Array.isArray(input.body.departmentIds) || input.body.departmentIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one department must be selected for department-wise assignment" });
  }

  if (input.body.assignmentMethod === "batch_wise" && (!Array.isArray(input.body.batchIds) || input.body.batchIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one batch must be selected for batch-wise assignment" });
  }

  if (Number(input.body?.restrictions?.paragraphWordLimit || 0) < 10) {
    ctx.addIssue({ code: "custom", message: "Paragraph word limit must be at least 10" });
  }
});

const transitionGlobalTestStatusSchema = z.object({
  body: z.object({
    action: z.enum(["SCHEDULE", "GO_LIVE", "COMPLETE", "ARCHIVE"]),
  }),
  params: z.object({
    testId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const cloneTestSchema = z.object({
  body: z.object({
    destinationCollegeId: idSchema,
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("batch_wise"),
    years: z.array(z.coerce.number().int().min(1).max(4)).min(1).max(4).optional(),
    departmentIds: z.array(idSchema).optional().default([]),
    batchIds: z.array(idSchema).optional().default([]),
  }),
  params: z.object({ testId: idSchema }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.assignmentMethod === "department_wise" && (!Array.isArray(input.body.departmentIds) || input.body.departmentIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one department must be selected for department-wise assignment" });
  }

  if (input.body.assignmentMethod === "batch_wise" && (!Array.isArray(input.body.batchIds) || input.body.batchIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one batch must be selected for batch-wise assignment" });
  }
});

const globalEventBodySchema = z.object({
  title: z.string().trim().min(3),
  description: z.string().trim().min(5),
  eventType: z.enum(["Hackathon", "Symposium", "Workshop", "Other"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  eventDate: z.string().datetime().optional().nullable(),
  registrationDeadline: z.string().datetime().optional().nullable(),
  location: z.string().trim().optional().nullable(),
  registrationLimit: z.number().int().min(1).max(10000).optional().nullable(),
  maxParticipants: z.number().int().min(1).max(10000).optional().nullable(),
  registrationUrl: z.string().url().optional().nullable(),
  feeType: z.enum(["free", "paid"]).optional(),
  registrationFee: z.number().min(0).optional(),
  registrationFields: z.array(
    z.object({
      key: z.string().trim().min(1),
      label: z.string().trim().min(1),
      type: z.enum(["text", "email", "number", "select", "textarea"]),
      required: z.boolean().default(false),
      options: z.array(z.string().trim()).optional().default([]),
      meta: z.record(z.any()).optional(),
    })
  ).optional().default([]),
  allColleges: z.boolean().default(false),
  collegeIds: z.array(idSchema).optional().default([]),
});

const createGlobalEventSchema = z.object({
  body: globalEventBodySchema,
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  const startsAt = new Date(input.body.startsAt);
  const eventDate = input.body.eventDate ? new Date(input.body.eventDate) : startsAt;
  const deadline = input.body.registrationDeadline ? new Date(input.body.registrationDeadline) : null;

  if (deadline && deadline > eventDate) {
    ctx.addIssue({ code: "custom", message: "registration_deadline must be less than or equal to event_date" });
  }

  const maxParticipants = Number(input.body.maxParticipants ?? input.body.registrationLimit ?? 1);
  if (!Number.isFinite(maxParticipants) || maxParticipants < 1) {
    ctx.addIssue({ code: "custom", message: "max_participants must be at least 1" });
  }

  if (input.body.feeType === "paid" && Number(input.body.registrationFee || 0) <= 0) {
    ctx.addIssue({ code: "custom", message: "registration_fee must be greater than 0 for paid events" });
  }
});

const updateGlobalEventSchema = z.object({
  body: globalEventBodySchema.omit({ allColleges: true, collegeIds: true }).partial().refine((body) => Object.keys(body).length > 0, {
    message: "At least one event field must be provided",
  }),
  params: z.object({
    eventId: idSchema,
  }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  const startsAt = input.body.startsAt ? new Date(input.body.startsAt) : null;
  const eventDate = input.body.eventDate ? new Date(input.body.eventDate) : startsAt;
  const deadline = input.body.registrationDeadline ? new Date(input.body.registrationDeadline) : null;

  if (deadline && eventDate && deadline > eventDate) {
    ctx.addIssue({ code: "custom", message: "registration_deadline must be less than or equal to event_date" });
  }

  const maxParticipants = Number(input.body.maxParticipants ?? input.body.registrationLimit ?? 1);
  if ((input.body.maxParticipants != null || input.body.registrationLimit != null) && (!Number.isFinite(maxParticipants) || maxParticipants < 1)) {
    ctx.addIssue({ code: "custom", message: "max_participants must be at least 1" });
  }

  if (input.body.feeType === "paid" && Number(input.body.registrationFee || 0) <= 0) {
    ctx.addIssue({ code: "custom", message: "registration_fee must be greater than 0 for paid events" });
  }
});

const globalEventIdParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({
    eventId: idSchema,
  }),
  query: z.object({}).optional().default({}),
});

const createSuperReportSchema = z.object({
  body: z.object({
    type: z.enum(["STUDENT_WISE", "TEST_WISE", "DEPARTMENT_WISE", "BATCH_WISE"]),
    filters: z.record(z.any()).optional().default({}),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const reportJobParamSchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({ reportJobId: idSchema }),
  query: z.object({}).optional().default({}),
});

const updatePlatformSettingsSchema = z.object({
  body: z.object({
    maxAttemptsDefault: z.number().int().min(1).max(10).optional(),
    defaultViolationLimit: z.number().int().min(1).max(20).optional(),
    globalRules: z.record(z.any()).optional(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superAdminPasswordSchema = z.string().superRefine((password, ctx) => {
  const result = validatePasswordPolicy(password);
  if (!result.valid) {
    ctx.addIssue({
      code: "custom",
      message: `Password must contain ${result.failures.join(", ")}.`,
    });
  }
});

const createSystemAdminSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    fullName: z.string().trim().min(2).optional(),
    email: z.string().trim().email(),
    password: superAdminPasswordSchema,
  }).superRefine((body, ctx) => {
    if (!body.name && !body.fullName) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "name is required",
      });
    }
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateSystemAdminStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
  }),
  params: z.object({ superAdminId: idSchema }),
  query: z.object({}).optional().default({}),
});

const resetSystemAdminPasswordSchema = z.object({
  body: z.object({
    password: superAdminPasswordSchema,
  }),
  params: z.object({ superAdminId: idSchema }),
  query: z.object({}).optional().default({}),
});

module.exports = {
  paginationQuerySchema,
  createCollegeSchema,
  updateCollegeSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  deleteDepartmentSchema,
  bulkImportDepartmentsSchema,
  createAdminSchema,
  updateAdminSchema,
  resetAdminPasswordSchema,
  deactivateAdminSchema,
  bulkImportAdminsSchema,
  createStudentGlobalSchema,
  superStudentBulkImportSchema,
  superStudentBulkImportJobParamSchema,
  promoteStudentsYearGlobalSchema,
  assignTestToBatchesSchema,
  createBatchGlobalSchema,
  updateBatchGlobalSchema,
  deleteBatchGlobalSchema,
  assignStudentsToGlobalBatchSchema,
  toggleStudentStatusSchema,
  resetStudentPasswordSchema,
  createGlobalTestSchema,
  updateGlobalTestSchema,
  cloneTestSchema,
  testIdParamSchema,
  transitionGlobalTestStatusSchema,
  createGlobalEventSchema,
  updateGlobalEventSchema,
  globalEventIdParamSchema,
  createSuperReportSchema,
  reportJobParamSchema,
  updatePlatformSettingsSchema,
  createSystemAdminSchema,
  updateSystemAdminStatusSchema,
  resetSystemAdminPasswordSchema,
};
