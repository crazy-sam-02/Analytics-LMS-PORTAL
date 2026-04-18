const express = require("express");
const { authenticate } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const {
  listOngoingTests,
  listUpcomingTests,
  startTest,
  getSession,
  saveAnswer,
  reportViolation,
  submitTest,
} = require("../../controllers/Students/tests.controller");
const {
  saveAnswerSchema,
  submitSchema,
  violationSchema,
  testIdOnlySchema,
} = require("../../schemas/Students/tests.schema");

const router = express.Router();

router.get("/ongoing", authenticate, listOngoingTests);
router.get("/upcoming", authenticate, listUpcomingTests);
router.post("/:testId/start", authenticate, validate(testIdOnlySchema), startTest);
router.get("/:testId/session", authenticate, validate(testIdOnlySchema), getSession);
router.post("/:testId/answer", authenticate, validate(saveAnswerSchema), saveAnswer);
router.post("/:testId/violation", authenticate, validate(violationSchema), reportViolation);
router.post("/:testId/submit", authenticate, validate(submitSchema), submitTest);

module.exports = router;
