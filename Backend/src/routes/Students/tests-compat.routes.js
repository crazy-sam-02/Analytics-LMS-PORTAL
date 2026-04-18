const express = require("express");
const { authenticate } = require("../../middleware/auth");
const validate = require("../../middleware/validate");
const {
  listOngoingTests,
  getSession,
  saveAnswer,
  submitTest,
  getAttemptResult,
} = require("../../controllers/Students/tests.controller");
const {
  testIdOnlySchema,
  saveAnswerCompatSchema,
  submitCompatSchema,
  attemptIdOnlySchema,
} = require("../../schemas/Students/tests.schema");

const router = express.Router();

router.get("/attempts/active", authenticate, listOngoingTests);

router.get("/test/:testId", authenticate, validate(testIdOnlySchema), getSession);
router.get("/results/:attemptId", authenticate, validate(attemptIdOnlySchema), getAttemptResult);
router.get("/submission/:attemptId", authenticate, validate(attemptIdOnlySchema), getAttemptResult);

router.post("/answer", authenticate, validate(saveAnswerCompatSchema), (req, _res, next) => {
  req.params.testId = req.body.testId;
  next();
}, saveAnswer);

router.post("/submit", authenticate, validate(submitCompatSchema), (req, _res, next) => {
  req.params.testId = req.body.testId;
  next();
}, submitTest);

module.exports = router;
