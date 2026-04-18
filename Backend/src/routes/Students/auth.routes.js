const express = require("express");
const validate = require("../../middleware/validate");
const { authenticate } = require("../../middleware/auth");
const { loginSchema, refreshSchema } = require("../../schemas/Students/auth.schema");
const { login, refresh, logout, me } = require("../../controllers/Students/auth.controller");

const router = express.Router();

router.post("/login", validate(loginSchema), login);
router.post("/refresh", validate(refreshSchema), refresh);
router.post("/logout", logout);
router.get("/me", authenticate, me);

module.exports = router;
