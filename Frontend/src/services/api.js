import { getAccessToken } from "@/services/httpClient";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const createTokenStorage = (prefix) => {
  const accessKey = `${prefix}_access_token`;
  const refreshKey = `${prefix}_refresh_token`;

  return {
    getAccess: () => localStorage.getItem(accessKey),
    getRefresh: () => localStorage.getItem(refreshKey),
    setTokens: ({ accessToken, refreshToken }) => {
      if (accessToken) {
        localStorage.setItem(accessKey, accessToken);
      }
      if (refreshToken) {
        localStorage.setItem(refreshKey, refreshToken);
      }
    },
    clear: () => {
      localStorage.removeItem(accessKey);
      localStorage.removeItem(refreshKey);
    },
  };
};

export const tokenStorage = {
  getAccess: () => getAccessToken(),
  getRefresh: () => null,
  setTokens: ({ accessToken }) => {
    void accessToken;
    return null;
  },
  clear: () => {
    return null;
  },
};
export const adminTokenStorage = createTokenStorage("lms_admin");
export const superAdminTokenStorage = createTokenStorage("lms_super_admin");

const buildApiErrorMessage = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "API request failed";
  }

  const message = payload.message || "API request failed";
  const formErrors = payload.details?.formErrors || [];
  const fieldErrors = payload.details?.fieldErrors || {};

  const firstFormError = Array.isArray(formErrors) ? formErrors.find(Boolean) : null;
  if (firstFormError) {
    return `${message}: ${firstFormError}`;
  }

  const firstFieldError = Object.values(fieldErrors)
    .find((errors) => Array.isArray(errors) && errors.length > 0)?.[0];

  return firstFieldError ? `${message}: ${firstFieldError}` : message;
};

const toApiError = (payload, status) => {
  const error = new Error(buildApiErrorMessage(payload));
  error.code = payload?.code || "REQUEST_FAILED";
  error.status = status;
  error.details = payload?.details || null;
  error.requestId = payload?.requestId || null;
  error.retryable = status >= 500 || status === 429;
  return error;
};

let refreshingPromise = null;
let adminRefreshingPromise = null;
let superAdminRefreshingPromise = null;

const refreshAccessToken = async () => {
  if (!refreshingPromise) {
    refreshingPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokenStorage.getRefresh() }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Refresh failed");
        const data = await response.json();
        tokenStorage.setTokens({ accessToken: data.accessToken });
        return data.accessToken;
      })
      .finally(() => {
        refreshingPromise = null;
      });
  }

  return refreshingPromise;
};

const refreshAdminAccessToken = async () => {
  if (!adminRefreshingPromise) {
    adminRefreshingPromise = fetch(`${API_BASE}/admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: adminTokenStorage.getRefresh() }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Refresh failed");
        const data = await response.json();
        adminTokenStorage.setTokens({ accessToken: data.accessToken });
        return data.accessToken;
      })
      .finally(() => {
        adminRefreshingPromise = null;
      });
  }

  return adminRefreshingPromise;
};

const refreshSuperAdminAccessToken = async () => {
  if (!superAdminRefreshingPromise) {
    superAdminRefreshingPromise = fetch(`${API_BASE}/super-admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: superAdminTokenStorage.getRefresh() }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Refresh failed");
        const data = await response.json();
        superAdminTokenStorage.setTokens({ accessToken: data.accessToken });
        return data.accessToken;
      })
      .finally(() => {
        superAdminRefreshingPromise = null;
      });
  }

  return superAdminRefreshingPromise;
};

export const apiRequest = async (path, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const accessToken = tokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401 && tokenStorage.getRefresh()) {
    try {
      const newAccessToken = await refreshAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      tokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw toApiError(payload, response.status);
  }

  return payload;
};

export const adminApiRequest = async (path, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const accessToken = adminTokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401 && adminTokenStorage.getRefresh()) {
    try {
      const newAccessToken = await refreshAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      adminTokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw toApiError(payload, response.status);
  }

  return payload;
};

export const adminApiTextRequest = async (path, options = {}) => {
  const headers = {
    ...(options.headers || {}),
  };

  const accessToken = adminTokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401 && adminTokenStorage.getRefresh()) {
    try {
      const newAccessToken = await refreshAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      adminTokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payloadText = await response.text();

  if (!response.ok) {
    let payload = {};
    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch {
      payload = { message: payloadText || "API request failed" };
    }
    throw toApiError(payload, response.status);
  }

  return payloadText;
};

export const superAdminApiRequest = async (path, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const accessToken = superAdminTokenStorage.getAccess();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const makeRequest = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

  let response = await makeRequest();

  if (response.status === 401 && superAdminTokenStorage.getRefresh()) {
    try {
      const newAccessToken = await refreshSuperAdminAccessToken();
      headers.Authorization = `Bearer ${newAccessToken}`;
      response = await makeRequest();
    } catch {
      superAdminTokenStorage.clear();
      throw new Error("Session expired. Please login again.");
    }
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw toApiError(payload, response.status);
  }

  return payload;
};

export const api = {
  login: (body) => apiRequest("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => apiRequest("/auth/me"),
  logout: (refreshToken) =>
    apiRequest("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  getDashboard: () => apiRequest("/dashboard/summary"),
  getOngoingTests: () => apiRequest("/tests/ongoing"),
  getUpcomingTests: () => apiRequest("/tests/upcoming"),
  startTest: (testId) => apiRequest(`/tests/${testId}/start`, { method: "POST", body: JSON.stringify({}) }),
  getSession: (testId) => apiRequest(`/tests/${testId}/session`),
  saveAnswer: (testId, body) =>
    apiRequest(`/tests/${testId}/answer`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reportViolation: (testId, body) =>
    apiRequest(`/tests/${testId}/violation`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitTest: (testId, body) =>
    apiRequest(`/tests/${testId}/submit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getReport: () => apiRequest("/reports/overview"),
  getLeaderboard: (params = "") => apiRequest(`/leaderboard${params}`),
  getEvents: (params = "") => apiRequest(`/events${params}`),
  getProfile: () => apiRequest("/profile"),
  updateProfile: (body) => apiRequest("/profile", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body) =>
    apiRequest("/profile/password", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  updatePreferences: (body) =>
    apiRequest("/profile/preferences", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export const adminApi = {
  login: (body) => adminApiRequest("/admin/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => adminApiRequest("/admin/auth/me"),
  logout: (refreshToken) =>
    adminApiRequest("/admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  getDashboard: () => adminApiRequest("/admin/dashboard/summary"),
  getTests: (params = "") => adminApiRequest(`/admin/tests${params}`),
  createTest: (body) => adminApiRequest("/admin/tests", { method: "POST", body: JSON.stringify(body) }),
  duplicateTest: (testId) => adminApiRequest(`/admin/tests/${testId}/duplicate`, { method: "POST", body: JSON.stringify({}) }),
  updateTest: (testId, body) => adminApiRequest(`/admin/tests/${testId}`, { method: "PATCH", body: JSON.stringify(body) }),
  transitionTestStatus: (testId, action) =>
    adminApiRequest(`/admin/tests/${testId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),
  getTestMonitoring: (testId) => adminApiRequest(`/admin/tests/${testId}/monitoring`),
  forceSubmitAttempt: (testId, body) => adminApiRequest(`/admin/tests/${testId}/monitoring/force-submit`, { method: "POST", body: JSON.stringify(body) }),
  extendAttemptTime: (testId, body) => adminApiRequest(`/admin/tests/${testId}/monitoring/extend-time`, { method: "POST", body: JSON.stringify(body) }),
  publishTest: (testId) => adminApiRequest(`/admin/tests/${testId}/publish`, { method: "POST", body: JSON.stringify({}) }),
  archiveTest: (testId) => adminApiRequest(`/admin/tests/${testId}/archive`, { method: "PATCH", body: JSON.stringify({}) }),
  deleteTest: (testId) => adminApiRequest(`/admin/tests/${testId}`, { method: "DELETE" }),
  getQuestionBank: (params = "") => adminApiRequest(`/admin/question-bank${params}`),
  getQuestionSubjects: () => adminApiRequest("/admin/subjects"),
  createQuestionSubject: (body) => adminApiRequest("/admin/subjects", { method: "POST", body: JSON.stringify(body) }),
  deleteQuestionSubject: (id) => adminApiRequest(`/admin/subjects/${id}`, { method: "DELETE" }),
  addQuestionBankItem: (body) => adminApiRequest("/admin/question-bank", { method: "POST", body: JSON.stringify(body) }),
  updateQuestionBankItem: (id, body) => adminApiRequest(`/admin/question-bank/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteQuestionBankItem: (id) => adminApiRequest(`/admin/question-bank/${id}`, { method: "DELETE" }),
  importQuestionBank: (body) => adminApiRequest("/admin/question-bank/import", { method: "POST", body: JSON.stringify(body) }),
  exportQuestionBank: () => adminApiRequest("/admin/question-bank/export"),
  getDepartments: () => adminApiRequest("/admin/departments"),
  getBatches: () => adminApiRequest("/admin/batches"),
  getBatchDetail: (batchId) => adminApiRequest(`/admin/batches/${batchId}`),
  createBatch: (body) => adminApiRequest("/admin/batches", { method: "POST", body: JSON.stringify(body) }),
  bulkBatchStudents: (batchId, body) => adminApiRequest(`/admin/batches/${batchId}/students/bulk`, { method: "POST", body: JSON.stringify(body) }),
  removeBatchStudent: (batchId, studentId) => adminApiRequest(`/admin/batches/${batchId}/students/${studentId}`, { method: "DELETE" }),
  archiveBatch: (batchId) => adminApiRequest(`/admin/batches/${batchId}/archive`, { method: "PATCH", body: JSON.stringify({}) }),
  assignTestToBatch: (testId, body) => adminApiRequest(`/admin/tests/${testId}/assign-batch`, { method: "POST", body: JSON.stringify(body) }),
  assignBatchStudents: (batchId, body) => adminApiRequest(`/admin/batches/${batchId}/students`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBatch: (batchId) => adminApiRequest(`/admin/batches/${batchId}`, { method: "DELETE" }),
  getStudents: (params = "") => adminApiRequest(`/admin/students${params}`),
  createStudent: (body) => adminApiRequest("/admin/students", { method: "POST", body: JSON.stringify(body) }),
  getStudentProfile: (studentId) => adminApiRequest(`/admin/students/${studentId}`),
  bulkImportStudents: (body) => adminApiRequest("/admin/students/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  getStudentImportJobStatus: (jobId) => adminApiRequest(`/admin/students/import-jobs/${jobId}`),
  assignStudentBatch: (studentId, body) => adminApiRequest(`/admin/students/${studentId}/assign-batch`, { method: "PATCH", body: JSON.stringify(body) }),
  getStudentPerformance: (studentId) => adminApiRequest(`/admin/students/${studentId}/performance`),
  getEvents: () => adminApiRequest("/admin/events"),
  getEventRegistrants: (eventId) => adminApiRequest(`/admin/events/${eventId}/registrants`),
  exportEventRegistrants: (eventId) => adminApiTextRequest(`/admin/events/${eventId}/export`),
  cancelEvent: (eventId, body) => adminApiRequest(`/admin/events/${eventId}/cancel`, { method: "PATCH", body: JSON.stringify(body) }),
  search: (query) => adminApiRequest(`/admin/search?q=${encodeURIComponent(query)}`),
  createEvent: (body) => adminApiRequest("/admin/events", { method: "POST", body: JSON.stringify(body) }),
  generateReport: (body) => adminApiRequest("/admin/reports/generate", { method: "POST", body: JSON.stringify(body) }),
  exportReport: (body) => adminApiRequest("/admin/reports/export", { method: "POST", body: JSON.stringify(body) }),
  getReportAnalytics: (params = "") => adminApiRequest(`/admin/reports/analytics${params}`),
  getReportJobs: () => adminApiRequest("/admin/reports"),
  getReportJobStatus: (reportJobId) => adminApiRequest(`/admin/reports/jobs/${reportJobId}/status`),
  getAdminJobStatus: (reportJobId) => adminApiRequest(`/admin/jobs/${reportJobId}/status`),
  downloadReport: (reportJobId) => adminApiRequest(`/admin/reports/${reportJobId}/download`),
  regenerateReportLink: (reportJobId) => adminApiRequest(`/admin/reports/jobs/${reportJobId}/regenerate-link`, { method: "POST", body: JSON.stringify({}) }),
  reviewReportAnomaly: (body) => adminApiRequest("/admin/reports/anomalies/review", { method: "POST", body: JSON.stringify(body) }),
  getSettings: () => adminApiRequest("/admin/settings"),
  updateSettings: (body) => adminApiRequest("/admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
  changePassword: (body) => adminApiRequest("/admin/settings/password", { method: "PATCH", body: JSON.stringify(body) }),
  getAuditLogs: (params = "") => adminApiRequest(`/admin/audit-logs${params}`),
};

export const superAdminApi = {
  login: (body) => superAdminApiRequest("/super-admin/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => superAdminApiRequest("/super-admin/auth/me"),
  logout: (refreshToken) =>
    superAdminApiRequest("/super-admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  getDashboard: () => superAdminApiRequest("/super-admin/dashboard/summary"),
  getSystemHealth: () => superAdminApiRequest("/super-admin/system/health"),
  getColleges: (params = "") => superAdminApiRequest(`/super-admin/colleges${params}`),
  createCollege: (body) => superAdminApiRequest("/super-admin/colleges", { method: "POST", body: JSON.stringify(body) }),
  updateCollege: (collegeId, body) => superAdminApiRequest(`/super-admin/colleges/${collegeId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateCollege: (collegeId) => superAdminApiRequest(`/super-admin/colleges/${collegeId}`, { method: "DELETE" }),
  getAdmins: (params = "") => superAdminApiRequest(`/super-admin/admins${params}`),
  createAdmin: (body) => superAdminApiRequest("/super-admin/admins", { method: "POST", body: JSON.stringify(body) }),
  bulkImportAdmins: (body) => superAdminApiRequest("/super-admin/admins/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  updateAdmin: (adminId, body) => superAdminApiRequest(`/super-admin/admins/${adminId}`, { method: "PATCH", body: JSON.stringify(body) }),
  resetAdminPassword: (adminId, body) => superAdminApiRequest(`/super-admin/admins/${adminId}/reset-password`, { method: "PATCH", body: JSON.stringify(body) }),
  deactivateAdmin: (adminId, body) => superAdminApiRequest(`/super-admin/admins/${adminId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getStudents: (params = "") => superAdminApiRequest(`/super-admin/students${params}`),
  createStudent: (body) => superAdminApiRequest("/super-admin/students", { method: "POST", body: JSON.stringify(body) }),
  bulkImportStudents: (body) => superAdminApiRequest("/super-admin/students/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  getStudentImportJobStatus: (jobId) => superAdminApiRequest(`/super-admin/students/import-jobs/${jobId}`),
  updateStudentStatus: (studentId, body) => superAdminApiRequest(`/super-admin/students/${studentId}/status`, { method: "PATCH", body: JSON.stringify(body) }),
  getTests: (params = "") => superAdminApiRequest(`/super-admin/tests${params}`),
  createGlobalTest: (body) => superAdminApiRequest("/super-admin/tests/global", { method: "POST", body: JSON.stringify(body) }),
  cloneTest: (testId, body) => superAdminApiRequest(`/super-admin/tests/${testId}/clone`, { method: "POST", body: JSON.stringify(body) }),
  deactivateTest: (testId) => superAdminApiRequest(`/super-admin/tests/${testId}`, { method: "DELETE" }),
  getBatches: (params = "") => superAdminApiRequest(`/super-admin/batches${params}`),
  createBatch: (body) => superAdminApiRequest("/super-admin/batches", { method: "POST", body: JSON.stringify(body) }),
  updateBatch: (batchId, body) => superAdminApiRequest(`/super-admin/batches/${batchId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBatch: (batchId, body) => superAdminApiRequest(`/super-admin/batches/${batchId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  getDepartments: (params = "") => superAdminApiRequest(`/super-admin/departments${params}`),
  createDepartment: (body) => superAdminApiRequest("/super-admin/departments", { method: "POST", body: JSON.stringify(body) }),
  bulkImportDepartments: (body) => superAdminApiRequest("/super-admin/departments/bulk-import", { method: "POST", body: JSON.stringify(body) }),
  updateDepartment: (departmentId, body) => superAdminApiRequest(`/super-admin/departments/${departmentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDepartment: (departmentId, body) => superAdminApiRequest(`/super-admin/departments/${departmentId}`, { method: "DELETE", body: JSON.stringify(body || {}) }),
  assignTestToBatches: (body) => superAdminApiRequest("/super-admin/batches/assign-test", { method: "POST", body: JSON.stringify(body) }),
  getEvents: (params = "") => superAdminApiRequest(`/super-admin/events${params}`),
  createEvent: (body) => superAdminApiRequest("/super-admin/events", { method: "POST", body: JSON.stringify(body) }),
  getReports: () => superAdminApiRequest("/super-admin/reports"),
  generateReport: (body) => superAdminApiRequest("/super-admin/reports/generate", { method: "POST", body: JSON.stringify(body) }),
  downloadReport: (reportJobId) => superAdminApiRequest(`/super-admin/reports/${reportJobId}/download`),
  regenerateReportLink: (reportJobId) => superAdminApiRequest(`/super-admin/reports/jobs/${reportJobId}/regenerate-link`, { method: "POST", body: JSON.stringify({}) }),
  getEscalatedAnomalies: (params = "") => superAdminApiRequest(`/super-admin/reports/anomalies/escalations${params}`),
  getAnalytics: () => superAdminApiRequest("/super-admin/analytics"),
  getAuditLogs: (params = "") => superAdminApiRequest(`/super-admin/audit-logs${params}`),
  getSettings: () => superAdminApiRequest("/super-admin/settings"),
  updateSettings: (body) => superAdminApiRequest("/super-admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
};
