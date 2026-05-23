require("dotenv").config();
const mongoose = require("mongoose");

const env = require("../src/config/env");
const { getRedisHealthSnapshot, shutdownRedis } = require("../src/config/redis");

const requiredIndexes = {
  testBatch: [
    ["batchId", "testId"],
    ["testId", "batchId"],
  ],
  test: [
    ["collegeId", "status"],
    ["collegeId", "assignmentMethod", "departmentId"],
    ["collegeId", "batchId"],
  ],
  submission: [
    ["collegeId", "testId", "status"],
    ["collegeId", "userId", "submittedAt"],
  ],
};

const mask = (value) => (value ? "set" : "missing");

const indexKeyNames = (index) => Object.keys(index.key || {});

const hasIndex = (indexes, fields) =>
  indexes.some((index) => {
    const keys = indexKeyNames(index);
    return fields.length === keys.length && fields.every((field, idx) => keys[idx] === field);
  });

const warnIfDevelopmentSecret = (name, value) => {
  const text = String(value || "").toLowerCase();
  if (!value || text.includes("development") || text.includes("change") || text.includes("secret-for-the-jwt")) {
    return [`${name} must be replaced with a strong production secret.`];
  }
  return [];
};

const run = async () => {
  const findings = [];

  console.log("Production readiness check");
  console.log(`NODE_ENV: ${env.nodeEnv}`);
  console.log(`MongoDB URI: ${mask(env.mongoUri)}`);
  console.log(`Redis URL: ${mask(env.redisUrl)}`);
  console.log(`Redis enabled: ${Boolean(env.redis.enabled)}`);
  console.log(`Redis queue enabled: ${Boolean(env.redis.queueEnabled)}`);

  findings.push(...warnIfDevelopmentSecret("JWT_ACCESS_SECRET", env.jwtAccessSecret));
  findings.push(...warnIfDevelopmentSecret("JWT_REFRESH_SECRET", env.jwtRefreshSecret));

  if (env.nodeEnv === "production" && !env.redis.enabled) {
    findings.push("Redis should be enabled for production traffic.");
  }

  if (env.nodeEnv === "production" && String(env.redisUrl || "").startsWith("redis://")) {
    findings.push("Use Redis AUTH/TLS in production when your provider supports it.");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });
  await mongoose.connection.db.admin().ping();
  console.log("MongoDB: ok");

  for (const [collectionName, specs] of Object.entries(requiredIndexes)) {
    const indexes = await mongoose.connection.db.collection(collectionName).indexes();
    for (const fields of specs) {
      if (!hasIndex(indexes, fields)) {
        findings.push(`Missing MongoDB index on ${collectionName}: ${fields.join(", ")}`);
      }
    }
  }

  const redis = await getRedisHealthSnapshot();
  console.log(`Redis: ${redis.status}${redis.latencyMs >= 0 ? ` (${redis.latencyMs}ms)` : ""}`);
  if (env.redis.enabled && redis.status !== "ok" && redis.status !== "degraded") {
    findings.push(`Redis is enabled but health is ${redis.status}${redis.error ? `: ${redis.error}` : ""}`);
  }

  await mongoose.disconnect();
  await shutdownRedis();

  if (findings.length > 0) {
    console.log("\nFindings:");
    findings.forEach((finding) => console.log(`- ${finding}`));
    process.exitCode = 1;
    return;
  }

  console.log("Readiness check passed.");
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  await shutdownRedis().catch(() => {});
  process.exitCode = 1;
});
