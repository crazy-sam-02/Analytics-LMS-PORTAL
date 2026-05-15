const http = require("http");
const net = require("net");
const mongoose = require("mongoose");
const app = require("./app");
const env = require("./config/env");
const { shutdownRedis } = require("./config/redis");
const { initSocket, shutdownSocket } = require("./realtime/socket");
const { startHeartbeatFlush, stopHeartbeatFlush } = require("./services/heartbeat-buffer.service");

const server = http.createServer(app);
initSocket(server, env.frontendOrigins || [env.frontendOrigin]);

const SHUTDOWN_TIMEOUT_MS = 15_000;

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed — no more incoming connections.");
  });

  // Give active requests time to finish, then force exit
  const forceTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  // Stop heartbeat buffer flush
  stopHeartbeatFlush();

  try {
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
  } catch (error) {
    console.error("Error disconnecting MongoDB:", error.message);
  }

  // Gracefully close Redis connection
  try {
    await shutdownSocket();
  } catch (error) {
    console.error("Error disconnecting Socket.IO Redis clients:", error.message);
  }

  try {
    await shutdownRedis();
    console.log("Redis disconnected.");
  } catch (error) {
    console.error("Error disconnecting Redis:", error.message);
  }

  clearTimeout(forceTimer);
  console.log("Shutdown complete.");
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Catch unhandled errors so a single failed promise doesn't crash the process
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException");
});

const parsePort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : 5000;
};

const canListenOnPort = (port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port);
  });

const startServer = async () => {
  const basePort = parsePort(env.port);
  let selectedPort = basePort;

  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = basePort + offset;
    const available = await canListenOnPort(candidate);
    if (available) {
      selectedPort = candidate;
      break;
    }
  }

  // Start heartbeat write buffer flush loop.
  // Batches heartbeat DB writes every 30s to reduce MongoDB load during exams.
  const db = require("./config/db");
  startHeartbeatFlush(async (batches) => {
    for (const { entries } of batches) {
      for (const entry of entries) {
        try {
          await db.submission.updateMany({
            where: { id: entry.submissionId },
            data: {
              lastHeartbeat: new Date(entry.at),
              connectionStatus: "ONLINE",
            },
          });
        } catch {
          // Fail-open — heartbeats are best-effort.
        }
      }
    }
  });

  server.listen(selectedPort, () => {
    if (selectedPort !== basePort) {
      console.warn(`Port ${basePort} is busy. Using fallback port ${selectedPort}.`);
    }
    console.log(`LMS API running at http://localhost:${selectedPort}`);
  });
};

startServer();

