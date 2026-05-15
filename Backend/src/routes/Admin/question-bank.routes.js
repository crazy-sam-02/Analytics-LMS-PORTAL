const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
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

router.get("/", authenticateAdmin, requireAnyPermission("manage_questions", "view_question_bank"), validate(questionBankQuerySchema), getQuestionBank);
router.post("/", authenticateAdmin, requirePermission("manage_questions"), validate(questionBankSchema), addQuestionBankItem);
router.post("/add", authenticateAdmin, requirePermission("manage_questions"), validate(questionBankSchema), addQuestionBankItem);
router.post("/bulk", authenticateAdmin, requirePermission("manage_questions", "bulk_import"), importQuestionBankJson);
router.post("/import", authenticateAdmin, requirePermission("manage_questions", "bulk_import"), importQuestionBankJson);
router.get("/export", authenticateAdmin, requireAnyPermission("manage_questions", "view_question_bank"), exportQuestionBankJson);
router.put("/:id", authenticateAdmin, requirePermission("manage_questions"), validate(updateQuestionBankSchema), updateQuestionBankItem);
router.delete("/:id", authenticateAdmin, requirePermission("manage_questions"), validate(questionBankParamSchema), deleteQuestionBankItem);

module.exports = router;
