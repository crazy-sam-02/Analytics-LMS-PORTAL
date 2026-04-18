const Redis = require("ioredis");
const env = require("./env");

let redisClient = null;

if (env.redisUrl) {
  redisClient = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });

  redisClient.on("error", (error) => {
    console.error("Redis connection error:", error.message);
  });
}

module.exports = redisClient;
