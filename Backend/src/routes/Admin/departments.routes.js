const express = require("express");
const { authenticateAdmin } = require("../../middleware/auth");
const { requireAnyPermission } = require("../../middleware/permissions");
const departmentsValidationController = require("../../controllers/Admin/departments-with-validation.controller");
const departmentsController = require("../../controllers/Admin/departments.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requireAnyPermission("manage_batches", "view_batches"), departmentsValidationController.getDepartments);

module.exports = router;
