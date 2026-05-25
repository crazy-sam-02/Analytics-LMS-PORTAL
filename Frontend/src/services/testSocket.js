import { io } from "socket.io-client";
import { getAccessToken } from "@/services/httpClient";
import { adminTokenStorage, superAdminTokenStorage } from "@/services/api";
import { SOCKET_BASE_URL } from "@/services/runtimeConfig";

const socketsByRole = new Map();

const getSocketUrl = () => {
  return SOCKET_BASE_URL;
};

const getSocketToken = (role = "student") => {
  if (role === "admin") {
    return adminTokenStorage.getAccess() || "";
  }
  if (role === "super-admin") {
    return superAdminTokenStorage.getAccess() || "";
  }
  return getAccessToken() || "";
};

export const connectTestSocket = (role = "student") => {
  const normalizedRole = role || "student";
  let socket = socketsByRole.get(normalizedRole);

  if (socket?.connected) {
    return socket;
  }

  if (!socket) {
    socket = io(getSocketUrl(), {
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
      auth: {
        token: getSocketToken(normalizedRole) ? `Bearer ${getSocketToken(normalizedRole)}` : "",
      },
    });
    socketsByRole.set(normalizedRole, socket);
  }

  socket.auth = {
    token: getSocketToken(normalizedRole) ? `Bearer ${getSocketToken(normalizedRole)}` : "",
  };

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
};

export const getTestSocket = (role = "student") => socketsByRole.get(role || "student") || null;

export const disconnectTestSocket = (role = null) => {
  if (role) {
    const socket = socketsByRole.get(role);
    if (socket?.connected) {
      socket.disconnect();
    }
    socketsByRole.delete(role);
    return;
  }

  for (const socket of socketsByRole.values()) {
    if (socket?.connected) {
      socket.disconnect();
    }
  }
  socketsByRole.clear();
};

export const joinTestRoom = (testId, role = "student") => {
  const socket = getTestSocket(role);
  if (!socket || !testId) return;
  socket.emit("join_test_room", { testId });
};

export const leaveTestRoom = (testId, role = "student") => {
  const socket = getTestSocket(role);
  if (!socket || !testId) return;
  socket.emit("leave_test_room", { testId });
};
