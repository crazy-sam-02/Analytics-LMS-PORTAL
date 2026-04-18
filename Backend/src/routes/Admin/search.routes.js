const express = require("express");
const { authenticateAdmin } = require("../../middleware/auth");
const { adminSearch } = require("../../controllers/Admin/search.controller");

const router = express.Router();

router.get("/", authenticateAdmin, adminSearch);

module.exports = router;
