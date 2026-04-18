const express = require("express");
const { authenticate } = require("../../middleware/auth");
const { getEvents, registerEvent } = require("../../controllers/Students/events.controller");

const router = express.Router();

router.get("/", authenticate, getEvents);
router.post("/:eventId/register", authenticate, registerEvent);

module.exports = router;
