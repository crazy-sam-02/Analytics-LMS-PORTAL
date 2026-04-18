const { Server } = require("socket.io");
const { verifyAccessToken } = require("../utils/token");

let io = null;

const initSocket = (httpServer, frontendOrigin) => {
  io = new Server(httpServer, {
    cors: {
      origin: frontendOrigin,
      credentials: true,
    },
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

module.exports = {
  initSocket,
  getIO,
  emitToCollege,
  emitToUser,
  emitToRole,
  emitToTestRoom,
};
