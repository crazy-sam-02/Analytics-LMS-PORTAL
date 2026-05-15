import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const STUDENT_ACCESS_TOKEN_KEY = "student_access_token";

const readStoredAccessToken = () => {
  try {
    return localStorage.getItem(STUDENT_ACCESS_TOKEN_KEY) || null;
  } catch {
    return null;
  }
};

const persistStoredAccessToken = (token) => {
  try {
    if (token) {
      localStorage.setItem(STUDENT_ACCESS_TOKEN_KEY, token);
      return;
    }

    localStorage.removeItem(STUDENT_ACCESS_TOKEN_KEY);
  } catch {
    // Ignore storage failures.
  }
};

let accessToken = readStoredAccessToken();
let isRefreshing = false;
let refreshWaitQueue = [];

let authHandlers = {
  onRefreshSuccess: null,
  onRefreshFailure: null,
  onAccountInactive: null,
};

const statusMessageMap = {
  400: "Invalid request",
  403: "No permission",
  404: "Not found",
  429: "Too many requests",
  500: "Server error",
};

export const mapHttpStatusMessage = (status) => statusMessageMap[Number(status)] || "Request failed";

const flushQueue = (error, token) => {
  refreshWaitQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
      return;
    }

    resolve(token);
  });

  refreshWaitQueue = [];
};

export const setAccessToken = (token) => {
  accessToken = token || null;
  persistStoredAccessToken(accessToken);
};

export const getAccessToken = () => accessToken;

const shouldForceLogoutAfterRefresh = (error) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;

  return status === 400 || status === 401 || status === 403 || code === "INVALID_REFRESH_TOKEN";
};

export const registerAuthInterceptorHandlers = (handlers) => {
  authHandlers = {
    ...authHandlers,
    ...handlers,
  };
};

export const httpClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

httpClient.interceptors.request.use((config) => {
  const nextConfig = { ...config };
  nextConfig.headers = nextConfig.headers || {};

  if (accessToken) {
    nextConfig.headers.Authorization = `Bearer ${accessToken}`;
  }

  return nextConfig;
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    const originalRequest = error?.config;
    const requestUrl = String(originalRequest?.url || "");
    const isRefreshEndpoint = requestUrl.includes("/auth/refresh");
    const isLoginEndpoint = requestUrl.includes("/auth/login");

    if (status === 403 && code === "ACCOUNT_INACTIVE") {
      authHandlers.onAccountInactive?.(error?.response?.data);
      return Promise.reject(error);
    }

    if (!originalRequest || status !== 401 || originalRequest._retry || isRefreshEndpoint || isLoginEndpoint) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshWaitQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return httpClient(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshResponse = await axios.post(
        `${API_BASE}/auth/refresh`,
        {},
        {
          withCredentials: true,
        }
      );

      const token = refreshResponse?.data?.accessToken || null;
      setAccessToken(token);
      authHandlers.onRefreshSuccess?.(refreshResponse?.data || null);
      flushQueue(null, token);

      originalRequest.headers = originalRequest.headers || {};
      if (token) {
        originalRequest.headers.Authorization = `Bearer ${token}`;
      }

      return httpClient(originalRequest);
    } catch (refreshError) {
      const forceLogout = shouldForceLogoutAfterRefresh(refreshError);
      if (forceLogout) {
        setAccessToken(null);
      }
      authHandlers.onRefreshFailure?.(refreshError, { forceLogout });
      flushQueue(refreshError, null);
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export const toApiError = (error) => {
  const payload = error?.response?.data || {};
  const status = error?.response?.status || null;
  const mappedStatusMessage = mapHttpStatusMessage(status);
  const retryAfterHeader = error?.response?.headers?.["retry-after"];
  const retryAfterSeconds = Number.parseInt(String(retryAfterHeader || "0"), 10);

  const apiError = new Error(payload?.message || mappedStatusMessage || error?.message || "Request failed");
  apiError.code = payload?.code || "REQUEST_FAILED";
  apiError.status = status;
  apiError.details = payload?.details || null;
  apiError.retryable = status >= 500 || status === 429 || !status;
  apiError.retryAfterSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds
    : Number(payload?.details?.retryAfterSeconds || 0) || null;
  return apiError;
};
