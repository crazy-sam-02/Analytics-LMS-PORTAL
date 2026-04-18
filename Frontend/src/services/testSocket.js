import { io } from "socket.io-client";
import { getAccessToken } from "@/services/httpClient";

let socket = null;

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/api\/?$/, "");

const getSocketToken = (role = "student") => {
  if (role === "admin") {
    return localStorage.getItem("lms_admin_access_token") || "";
  }
  return getAccessToken() || "";
};

export const connectTestSocket = (role = "student") => {
  if (socket?.connected) {
    return socket;
  }

  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
      auth: {
        token: getSocketToken(role) ? `Bearer ${getSocketToken(role)}` : "",
      },
    });
  }

  socket.auth = {
    token: getSocketToken(role) ? `Bearer ${getSocketToken(role)}` : "",
  };

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
};

export const getTestSocket = () => socket;

export const disconnectTestSocket = () => {
  if (socket?.connected) {
    socket.disconnect();
  }
};

export const joinTestRoom = (testId) => {
  if (!socket || !testId) return;
  socket.emit("join_test_room", { testId });
};

export const leaveTestRoom = (testId) => {
  if (!socket || !testId) return;
  socket.emit("leave_test_room", { testId });
};
