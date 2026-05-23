const { z } = require("zod");

const superAdminLoginSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Invalid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const superAdminRefreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10).optional(),
  }).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  superAdminLoginSchema,
  superAdminRefreshSchema,
};
