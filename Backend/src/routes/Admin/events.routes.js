const express = require("express");
const validate = require("../../middleware/validate");
const { imageUpload } = require("../../middleware/upload");
const { normalizeEventForm } = require("../../middleware/normalize-event-form");
const { authenticateAdmin } = require("../../middleware/auth");
const { requireAnyPermission, requirePermission } = require("../../middleware/permissions");
const { createEventSchema, updateEventSchema, eventIdParamSchema, cancelEventSchema } = require("../../schemas/Admin/admin-core.schema");
const { createEvent, getEvents, updateEvent, deleteEvent, getEventRegistrants, exportEventRegistrants, cancelEvent } = require("../../controllers/Admin/events.controller");

const router = express.Router();

router.get("/", authenticateAdmin, requireAnyPermission("manage_events", "view_events"), getEvents);
router.post("/", authenticateAdmin, requirePermission("manage_events"), imageUpload.single("eventImage"), normalizeEventForm, validate(createEventSchema), createEvent);
router.patch("/:eventId", authenticateAdmin, requirePermission("manage_events"), imageUpload.single("eventImage"), normalizeEventForm, validate(updateEventSchema), updateEvent);
router.delete("/:eventId", authenticateAdmin, requirePermission("manage_events"), validate(eventIdParamSchema), deleteEvent);
router.get("/:eventId/registrants", authenticateAdmin, requireAnyPermission("manage_events", "view_events"), validate(eventIdParamSchema), getEventRegistrants);
router.get("/:eventId/export", authenticateAdmin, requireAnyPermission("manage_events", "view_events"), validate(eventIdParamSchema), exportEventRegistrants);
router.patch("/:eventId/cancel", authenticateAdmin, requirePermission("manage_events"), validate(cancelEventSchema), cancelEvent);

module.exports = router;
