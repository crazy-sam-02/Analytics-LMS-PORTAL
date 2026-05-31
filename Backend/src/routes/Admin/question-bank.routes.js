const express = require("express");
const env = require("../../config/env");
const validate = require("../../middleware/validate");
const { authenticatePlatformAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const {
	questionBankSchema,
	questionBankQuerySchema,
	questionBankParamSchema,
	updateQuestionBankSchema,
} = require("../../schemas/Admin/admin-core.schema");
const {
	addQuestionBankItem,
	getQuestionBank,
	exportQuestionBankJson,
	importQuestionBankJson,
	updateQuestionBankItem,
	deleteQuestionBankItem,
} = require("../../controllers/Admin/question-bank.controller");

const router = express.Router();

const adminQuestionBankWriteLimiter = createRateLimiter({
	scope: "admin-question-bank-write",
	routeLabel: "/api/admin/question-bank/*",
	windowMs: env.rateLimit.adminEntityWriteWindowMs,
	max: env.rateLimit.adminEntityWriteMax,
	failOpen: false,
	message: "Question-bank write actions are rate limited. Please retry shortly.",
});

router.get("/", authenticatePlatformAdmin, requireAnyPermission("manage_questions", "view_question_bank"), validate(questionBankQuerySchema), getQuestionBank);
router.post("/", authenticatePlatformAdmin, adminQuestionBankWriteLimiter, requirePermission("manage_questions"), validate(questionBankSchema), addQuestionBankItem);
router.post("/add", authenticatePlatformAdmin, adminQuestionBankWriteLimiter, requirePermission("manage_questions"), validate(questionBankSchema), addQuestionBankItem);
router.post("/bulk", authenticatePlatformAdmin, adminQuestionBankWriteLimiter, requirePermission("manage_questions", "bulk_import"), importQuestionBankJson);
router.post("/import", authenticatePlatformAdmin, adminQuestionBankWriteLimiter, requirePermission("manage_questions", "bulk_import"), importQuestionBankJson);
router.get("/export", authenticatePlatformAdmin, requireAnyPermission("manage_questions", "view_question_bank"), exportQuestionBankJson);
router.put("/:id", authenticatePlatformAdmin, adminQuestionBankWriteLimiter, requirePermission("manage_questions"), validate(updateQuestionBankSchema), updateQuestionBankItem);
router.delete("/:id", authenticatePlatformAdmin, adminQuestionBankWriteLimiter, requirePermission("manage_questions"), validate(questionBankParamSchema), deleteQuestionBankItem);

module.exports = router;


