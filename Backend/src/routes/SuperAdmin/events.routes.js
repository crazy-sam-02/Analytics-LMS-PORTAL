const express = require("express");
const validate = require("../../middleware/validate");
const { authenticateSuperAdmin } = require("../../middleware/auth");
const { paginationQuerySchema, createGlobalEventSchema } = require("../../schemas/SuperAdmin/super-admin-core.schema");
const { getEventsGlobal, createGlobalEvent } = require("../../controllers/SuperAdmin/events.controller");

const router = express.Router();

router.get("/", authenticateSuperAdmin, validate(paginationQuerySchema), getEventsGlobal);
router.post("/", authenticateSuperAdmin, validate(createGlobalEventSchema), createGlobalEvent);

module.exports = router;
