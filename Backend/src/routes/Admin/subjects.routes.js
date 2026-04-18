const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { createSubjectSchema } = require("../../schemas/Admin/admin-core.schema");
const { getSubjects, createSubject, deleteSubject } = require("../../controllers/Admin/subjects.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("manage_questions"), getSubjects);
router.post("/", authenticateAdmin, requirePermission("manage_questions"), validate(createSubjectSchema), createSubject);
router.delete("/:id", authenticateAdmin, requirePermission("manage_questions"), deleteSubject);

module.exports = router;