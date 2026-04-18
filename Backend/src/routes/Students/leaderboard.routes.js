const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { getLeaderboard } = require("../../controllers/Students/leaderboard.controller");

const router = express.Router();

router.get("/", authenticate, getLeaderboard);

module.exports = router;
