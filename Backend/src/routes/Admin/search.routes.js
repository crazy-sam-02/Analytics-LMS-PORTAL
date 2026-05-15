const express = require("express");
const env = require("../../config/env");
const { authenticateAdmin } = require("../../middleware/auth");
const { createRateLimiter } = require("../../middleware/rate-limit");
const { createResponseCache } = require("../../middleware/response-cache");
const { adminSearch } = require("../../controllers/Admin/search.controller");

const router = express.Router();

const adminSearchCache = createResponseCache({
	scope: "admin-search",
	ttlSeconds: env.responseCache.adminSearchTtlSeconds,
	keyBuilder: (req) => `${req.admin?.collegeId || "unknown"}:${String(req.query.q || "").trim().toLowerCase()}`,
});

const adminSearchLimiter = createRateLimiter({
	scope: "admin-search",
	routeLabel: "/api/admin/search",
	windowMs: env.rateLimit.searchWindowMs,
	max: env.rateLimit.searchMax,
	message: "Search is temporarily rate limited. Please keep typing and retry.",
});

router.get("/", authenticateAdmin, adminSearchCache, adminSearchLimiter, adminSearch);

module.exports = router;
