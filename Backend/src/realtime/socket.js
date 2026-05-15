const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const Redis = require("ioredis");
const { verifyAccessToken } = require("../utils/token");
const env = require("../config/env");

let io = null;
let socketRedisPubClient = null;
let socketRedisSubClient = null;

const attachRedisAdapterIfAvailable = async () => {
  if (!io || !env.redis?.enabled || !env.redisUrl) {
    return;
  }

  // One-shot Redis adapter bootstrap:
  // if Redis is down, fall back to in-memory adapter without retry storms.
  const pubClient = new Redis(env.redisUrl, {
    connectionName: `lms-socket-pub:${env.nodeEnv}`,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    retryStrategy: () => null,
  });

  const subClient = pubClient.duplicate({
    connectionName: `lms-socket-sub:${env.nodeEnv}`,
    lazyConnect: true,
    retryStrategy: () => null,
    connectTimeout: 3000,
  });

  pubClient.on("error", (err) => {
    console.error("Socket.IO Redis pub client error:", err.message);
  });
  subClient.on("error", (err) => {
    console.error("Socket.IO Redis sub client error:", err.message);
  });

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    socketRedisPubClient = pubClient;
    socketRedisSubClient = subClient;
    console.log("Socket.IO Redis adapter attached for horizontal scaling.");
  } catch (error) {
    console.warn("Socket.IO Redis adapter unavailable, using in-memory adapter:", error?.message || "connection failed");
    try {
      pubClient.disconnect();
      subClient.disconnect();
    } catch {
      // noop
    }
  }
};

const initSocket = (httpServer, frontendOrigins) => {
  const allowedOrigins = Array.isArray(frontendOrigins)
    ? frontendOrigins
    : [frontendOrigins].filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  attachRedisAdapterIfAvailable().catch((error) => {
    console.warn("Socket.IO Redis adapter bootstrap error, using in-memory adapter:", error?.message || "unknown error");
  });

  io.use((socket, next) => {
    try {
      const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const principal = verifyAccessToken(token);
      socket.data.user = principal;
      return next();
    } catch (_error) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`role:${user.role}`);
    socket.join(`user:${user.sub}`);
    if (user.collegeId) {
      socket.join(`college:${user.collegeId}`);
    }

    socket.on("join_test_room", ({ testId } = {}) => {
      if (!testId) return;
      socket.join(`test_${testId}`);
    });

    socket.on("leave_test_room", ({ testId } = {}) => {
      if (!testId) return;
      socket.leave(`test_${testId}`);
    });
  });

  return io;
};

const getIO = () => io;

const emitToCollege = (collegeId, event, payload) => {
  if (!io || !collegeId) return;
  io.to(`college:${collegeId}`).emit(event, payload);
};

const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

const emitToRole = (role, event, payload) => {
  if (!io || !role) return;
  io.to(`role:${role}`).emit(event, payload);
};

const emitToTestRoom = (testId, event, payload) => {
  if (!io || !testId) return;
  io.to(`test_${testId}`).emit(event, payload);
};

const shutdownSocket = async () => {
  const closeClient = async (client) => {
    if (!client) return;
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  };

  await Promise.all([closeClient(socketRedisPubClient), closeClient(socketRedisSubClient)]);
  socketRedisPubClient = null;
  socketRedisSubClient = null;
};

module.exports = {
  initSocket,
  getIO,
  emitToCollege,
  emitToUser,
  emitToRole,
  emitToTestRoom,
  shutdownSocket,
};

