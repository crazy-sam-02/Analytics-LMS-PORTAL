const { z } = require("zod");

const idSchema = z.string().trim().refine(
  (value) => z.string().cuid().safeParse(value).success || z.string().uuid().safeParse(value).success,
  "Invalid identifier"
);

const paginationQuerySchema = z.object({
  body: z.object({}).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    collegeId: idSchema.optional(),
    departmentId: idSchema.optional(),
    batchId: idSchema.optional(),
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
  }),
  params: z.object({ collegeId: z.string().cuid() }),
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
    collegeId: idSchema,
    departmentId: idSchema.optional().nullable(),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateAdminSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).optional(),
    collegeId: idSchema.optional(),
    departmentId: idSchema.optional().nullable(),
    isActive: z.boolean().optional(),
  }),
  params: z.object({ adminId: idSchema }),
  query: z.object({}).optional().default({}),
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
    collegeId: idSchema,
    departmentId: idSchema.optional(),
    department: z.string().trim().min(2).optional(),
    batchId: idSchema.optional().nullable(),
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
    departmentId: idSchema,
    studentIds: z.array(idSchema).optional().default([]),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const updateBatchGlobalSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    departmentId: idSchema.optional(),
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

const toggleStudentStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
    confirmationText: z.string().trim().optional(),
  }),
  params: z.object({ studentId: idSchema }),
  query: z.object({}).optional().default({}),
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
    collegeIds: z.array(z.string().cuid()).optional().default([]),
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("department_wise"),
    departmentIds: z.array(z.string().cuid()).optional().default([]),
    batchIds: z.array(z.string().cuid()).optional().default([]),
    questions: z.array(
      z.object({
        prompt: z.string().trim().min(1),
        type: z.enum(["MCQ", "TRUE_FALSE", "FILL_BLANK", "PARAGRAPH"]),
        options: z.array(z.string()).optional().default([]),
        correctOption: z.string().optional().nullable(),
        correctBoolean: z.boolean().optional().nullable(),
        correctText: z.string().optional().nullable(),
        marks: z.number().int().min(1).default(1),
      })
    ).min(1),
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
});

const cloneTestSchema = z.object({
  body: z.object({
    destinationCollegeId: z.string().cuid(),
    assignmentMethod: z.enum(["department_wise", "batch_wise"]).default("batch_wise"),
    departmentIds: z.array(z.string().cuid()).optional().default([]),
    batchIds: z.array(z.string().cuid()).optional().default([]),
  }),
  params: z.object({ testId: z.string().cuid() }),
  query: z.object({}).optional().default({}),
}).superRefine((input, ctx) => {
  if (input.body.assignmentMethod === "department_wise" && (!Array.isArray(input.body.departmentIds) || input.body.departmentIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one department must be selected for department-wise assignment" });
  }

  if (input.body.assignmentMethod === "batch_wise" && (!Array.isArray(input.body.batchIds) || input.body.batchIds.length === 0)) {
    ctx.addIssue({ code: "custom", message: "At least one batch must be selected for batch-wise assignment" });
  }
});

const createGlobalEventSchema = z.object({
  body: z.object({
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
    collegeIds: z.array(z.string().cuid()).optional().default([]),
  }),
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
  params: z.object({ reportJobId: z.string().cuid() }),
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
  assignTestToBatchesSchema,
  createBatchGlobalSchema,
  updateBatchGlobalSchema,
  deleteBatchGlobalSchema,
  toggleStudentStatusSchema,
  createGlobalTestSchema,
  cloneTestSchema,
  createGlobalEventSchema,
  createSuperReportSchema,
  reportJobParamSchema,
  updatePlatformSettingsSchema,
};
