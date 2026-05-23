const { z } = require("zod");

const adminLoginSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const adminRefreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10).optional(),
  }).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  adminLoginSchema,
  adminRefreshSchema,
};
