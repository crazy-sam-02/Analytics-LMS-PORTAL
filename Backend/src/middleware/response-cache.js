const crypto = require("crypto");
const { redisClient, isRedisAvailable } = require("../config/redis");
const { verifyAccessToken } = require("../utils/token");

const memoryStore = new Map();
const memoryTagIndex = new Map();

const hash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const getPathname = (originalUrl = "") => {
  const [pathname] = String(originalUrl).split("?");
  return pathname || "/";
};

const getRequestActor = (req) => {
  if (req.admin?.id) {
    return `admin:${req.admin.id}`;
  }

  if (req.superAdmin?.id) {
    return `super-admin:${req.superAdmin.id}`;
  }

  if (req.user?.id) {
    return `student:${req.user.id}`;
  }

  if (req.student?.id) {
    return `student:${req.student.id}`;
  }

  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return `ip:${req.ip || "unknown"}`;
  }

  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    const role = payload?.role || "ANON";
    const id = payload?.sub || payload?.id || req.ip || "unknown";
    return `${role}:${id}`;
  } catch {
    return `ip:${req.ip || "unknown"}`;
  }
};

const buildCacheKey = ({ req, scope, keyBuilder }) => {
  const rawKey = keyBuilder
    ? keyBuilder(req)
    : `${req.method}:${getPathname(req.originalUrl)}:${JSON.stringify(req.query || {})}:${getRequestActor(req)}`;
  return `resp_cache:${scope}:${hash(rawKey)}`;
};

const setMemoryCache = (key, value, ttlSeconds, tags) => {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  memoryStore.set(key, { value, expiresAt, tags });

  for (const tag of tags) {
    const current = memoryTagIndex.get(tag) || new Set();
    current.add(key);
    memoryTagIndex.set(tag, current);
  }
};

const getMemoryCache = (key) => {
  const entry = memoryStore.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return entry.value;
};

const setRedisCache = async (key, payload, ttlSeconds, tags) => {
  await redisClient.set(key, JSON.stringify(payload), "EX", ttlSeconds);

  for (const tag of tags) {
    const tagKey = `resp_cache_tag:${tag}`;
    await redisClient.sadd(tagKey, key);
    await redisClient.expire(tagKey, Math.max(ttlSeconds * 4, ttlSeconds));
  }
};

const getRedisCache = async (key) => {
  const raw = await redisClient.get(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const createResponseCache = ({
  scope,
  ttlSeconds = 30,
  enabled = true,
  keyBuilder,
  tagsBuilder,
  shouldCache,
}) => (req, res, next) => {
  if (!enabled || req.method !== "GET") {
    return next();
  }

  const cacheKey = buildCacheKey({ req, scope, keyBuilder });

  const readFromCache = async () => {
    if (!isRedisAvailable()) {
      return getMemoryCache(cacheKey);
    }

    try {
      return await getRedisCache(cacheKey);
    } catch {
      return getMemoryCache(cacheKey);
    }
  };

  const writeToCache = async (payload, tags) => {
    if (!isRedisAvailable()) {
      setMemoryCache(cacheKey, payload, ttlSeconds, tags);
      return;
    }

    try {
      await setRedisCache(cacheKey, payload, ttlSeconds, tags);
    } catch {
      setMemoryCache(cacheKey, payload, ttlSeconds, tags);
    }
  };

  readFromCache()
    .then((cached) => {
      if (cached) {
        res.setHeader("X-Response-Cache", "HIT");
        if (cached.headers && typeof cached.headers === "object") {
          for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            if (headerValue) {
              res.setHeader(headerName, headerValue);
            }
          }
        }
        return res.status(cached.statusCode || 200).json(cached.body);
      }

      res.setHeader("X-Response-Cache", "MISS");
      const originalJson = res.json.bind(res);

      res.json = (body) => {
        const canStore =
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          (typeof shouldCache !== "function" || shouldCache(req, res, body));

        if (canStore) {
          const tags = Array.isArray(tagsBuilder) ? tagsBuilder : typeof tagsBuilder === "function" ? tagsBuilder(req, res, body) : [];
          const normalizedTags = Array.from(new Set(tags.filter(Boolean)));
          const payload = {
            statusCode: res.statusCode,
            body,
            headers: {
              "Cache-Control": res.getHeader("Cache-Control") || undefined,
            },
          };

          writeToCache(payload, normalizedTags).catch(() => {});
        }

        return originalJson(body);
      };

      return next();
    })
    .catch(() => next());
};

const invalidateResponseCacheByTags = async (tags = []) => {
  const normalizedTags = Array.from(new Set((tags || []).filter(Boolean)));
  if (normalizedTags.length === 0) {
    return;
  }

  if (!isRedisAvailable()) {
    for (const tag of normalizedTags) {
      const keys = memoryTagIndex.get(tag) || new Set();
      for (const key of keys) {
        memoryStore.delete(key);
      }
      memoryTagIndex.delete(tag);
    }
    return;
  }

  try {
    const tagKeys = normalizedTags.map((tag) => `resp_cache_tag:${tag}`);
    const memberArrays = await Promise.all(tagKeys.map((tagKey) => redisClient.smembers(tagKey)));
    const keysToDelete = Array.from(new Set(memberArrays.flat()));

    const pipeline = redisClient.pipeline();
    if (keysToDelete.length > 0) {
      pipeline.del(...keysToDelete);
    }
    pipeline.del(...tagKeys);
    await pipeline.exec();
  } catch {
    // Keep invalidation fail-open.
  }
};

const createResponseCacheInvalidationHook = () => (req, res, next) => {
  res.on("finish", () => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      return;
    }

    if (res.statusCode >= 400) {
      return;
    }

    const pathname = getPathname(req.originalUrl);
    const tags = [];

    if (
      pathname.startsWith("/api/admin/reports") ||
      pathname.startsWith("/api/admin/tests") ||
      pathname.startsWith("/api/tests") ||
      pathname.startsWith("/api/attempts")
    ) {
      tags.push("admin-reports:all");
      if (req.admin?.collegeId) {
        tags.push(`admin-reports:college:${req.admin.collegeId}`);
      }

      tags.push("student-tests:all", "student-dashboard:all");

      if (req.user?.id) {
        tags.push(`student-tests:user:${req.user.id}`, `student-dashboard:user:${req.user.id}`);
      }
      if (req.user?.collegeId) {
        tags.push(`student-tests:college:${req.user.collegeId}`, `student-dashboard:college:${req.user.collegeId}`);
      }

      if (req.admin?.collegeId) {
        tags.push(
          `student-tests:college:${req.admin.collegeId}`,
          `student-dashboard:college:${req.admin.collegeId}`,
          `admin-dashboard:college:${req.admin.collegeId}`
        );
      }
    }

    if (
      pathname.startsWith("/api/super-admin/reports") ||
      pathname.startsWith("/api/superadmin/reports") ||
      pathname.startsWith("/api/super-admin/analytics") ||
      pathname.startsWith("/api/superadmin/analytics") ||
      pathname.startsWith("/api/super-admin/tests") ||
      pathname.startsWith("/api/superadmin/tests")
    ) {
      tags.push("super-analytics:all", "super-dashboard:all");
    }

    if (tags.length > 0) {
      invalidateResponseCacheByTags(tags).catch(() => {});
    }
  });

  next();
};

module.exports = {
  createResponseCache,
  createResponseCacheInvalidationHook,
  invalidateResponseCacheByTags,
};
