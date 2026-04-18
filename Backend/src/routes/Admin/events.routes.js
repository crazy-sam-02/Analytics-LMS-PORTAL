const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateAdmin } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/permissions");
const { createEventSchema, eventIdParamSchema, cancelEventSchema } = require("../../schemas/Admin/admin-core.schema");
const { createEvent, getEvents, getEventRegistrants, exportEventRegistrants, cancelEvent } = require("../../controllers/Admin/events.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requirePermission("manage_events"), getEvents);
router.post("/", authenticateAdmin, requirePermission("manage_events"), validate(createEventSchema), createEvent);
router.get("/:eventId/registrants", authenticateAdmin, requirePermission("manage_events"), validate(eventIdParamSchema), getEventRegistrants);
router.get("/:eventId/export", authenticateAdmin, requirePermission("manage_events"), validate(eventIdParamSchema), exportEventRegistrants);
router.patch("/:eventId/cancel", authenticateAdmin, requirePermission("manage_events"), validate(cancelEventSchema), cancelEvent);

module.exports = router;
