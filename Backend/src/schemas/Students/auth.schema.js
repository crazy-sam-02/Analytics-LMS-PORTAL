const { z } = require("zod");

const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(3),
    password: z.string().min(7),
    keepLoggedIn: z.boolean().optional().default(true),
  }),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10).optional(),
  }).optional().default({}),
  params: z.object({}).optional().default({}),
  query: z.object({}).optional().default({}),
});

module.exports = {
  loginSchema,
  refreshSchema,
};
