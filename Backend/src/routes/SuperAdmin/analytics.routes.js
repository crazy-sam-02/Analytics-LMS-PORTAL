const express = require("express");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { getSuperAnalytics } = require("../../controllers/SuperAdmin/analytics.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, getSuperAnalytics);

module.exports = router;
