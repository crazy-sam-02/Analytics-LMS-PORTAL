const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
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
} = require("../../controllers/SuperAdmin/question-bank.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(questionBankQuerySchema), getQuestionBank);
router.post("/", authenticateSuperAdmin, validate(questionBankSchema), addQuestionBankItem);
router.post("/add", authenticateSuperAdmin, validate(questionBankSchema), addQuestionBankItem);
router.post("/bulk", authenticateSuperAdmin, importQuestionBankJson);
router.post("/import", authenticateSuperAdmin, importQuestionBankJson);
router.get("/export", authenticateSuperAdmin, exportQuestionBankJson);
router.put("/:id", authenticateSuperAdmin, validate(updateQuestionBankSchema), updateQuestionBankItem);
router.delete("/:id", authenticateSuperAdmin, validate(questionBankParamSchema), deleteQuestionBankItem);

module.exports = router;
