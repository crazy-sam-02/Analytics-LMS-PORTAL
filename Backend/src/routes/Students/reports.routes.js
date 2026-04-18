const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { getReport } = require("../../controllers/Students/reports.controller");

const router = express.Router();

router.get("/", authenticate, getReport);
router.get("/overview", authenticate, getReport);

module.exports = router;
