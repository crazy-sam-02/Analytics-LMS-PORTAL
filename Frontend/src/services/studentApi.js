import { httpClient, toApiError } from "@/services/httpClient";

const withServerTime = (response) => ({
  data: response?.data,
  serverTime: response?.headers?.date ? new Date(response.headers.date).getTime() : Date.now(),
});

export const studentApi = {
  login: async (payload) => {
    try {
      const response = await httpClient.post("/auth/login", payload);
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  refreshSession: async () => {
    try {
      const response = await httpClient.post("/auth/refresh", {});
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  me: async () => {
    try {
      const response = await httpClient.get("/auth/me");
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  logout: async () => {
    try {
      await httpClient.post("/auth/logout", {});
    } catch (error) {
      throw toApiError(error);
    }
  },

  getEvents: async () => {
    try {
      const response = await httpClient.get("/events");
      const { data, serverTime } = withServerTime(response);
      return {
        items: Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [],
        serverTime,
      };
    } catch (error) {
      throw toApiError(error);
    }
  },

  registerEvent: async (eventId) => {
    try {
      const response = await httpClient.post(`/events/${eventId}/register`, {});
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  uploadMyAvatar: async (file) => {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const response = await httpClient.post("/profile/avatar", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.post("/students/me/avatar", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  changeMyPassword: async (payload) => {
    try {
      const response = await httpClient.patch("/profile/password", payload);
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.patch("/students/me/password", payload);
        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  updateMyPreferences: async (payload) => {
    try {
      const response = await httpClient.patch("/profile/preferences", payload);
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallback = await httpClient.patch("/students/me/preferences", payload);
        return fallback.data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  getUnreadNotifications: async ({ page = 1, limit = 20 } = {}) => {
    try {
      const response = await httpClient.get("/notifications", {
        params: {
          unread: true,
          page,
          limit,
        },
      });
      const { data, serverTime } = withServerTime(response);

      return {
        items: Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [],
        page: Number(data?.pagination?.page || page),
        totalPages: Number(data?.pagination?.totalPages || 1),
        hasMore: Boolean(data?.pagination ? Number(data.pagination.page || page) < Number(data.pagination.totalPages || 1) : false),
        serverTime,
      };
    } catch (error) {
      throw toApiError(error);
    }
  },

  markNotificationRead: async (notificationId) => {
    try {
      const response = await httpClient.patch(`/notifications/${notificationId}/read`, {});
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  markAllNotificationsRead: async () => {
    try {
      const response = await httpClient.patch("/notifications/read-all", {});
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  getActiveAttempts: async () => {
    try {
      const response = await httpClient.get("/attempts/active");
      const { data, serverTime } = withServerTime(response);
      return {
        items: Array.isArray(data) ? data : [],
        serverTime,
      };
    } catch (error) {
      throw toApiError(error);
    }
  },

  startAttempt: async ({ test_id }) => {
    try {
      const response = await httpClient.post("/attempts/start", { test_id });
      return withServerTime(response).data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const legacyResponse = await httpClient.post(`/tests/${test_id}/start`, {});
        return withServerTime(legacyResponse).data;
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  getAttemptSession: async (attemptId) => {
    try {
      const response = await httpClient.get(`/attempts/${attemptId}`);
      return withServerTime(response).data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const activeAttempts = await studentApi.getActiveAttempts();
        const attempt = (activeAttempts?.items || []).find(
          (item) => String(item?.submissionId || item?.attempt_id || "") === String(attemptId)
        );

        if (!attempt?.id && !attempt?.test_id && !attempt?.testId) {
          const notFound = new Error("Attempt not found");
          notFound.status = 404;
          notFound.code = "ATTEMPT_NOT_FOUND";
          throw notFound;
        }

        const testId = attempt.id || attempt.test_id || attempt.testId;
        const session = await studentApi.getTestSession(testId);
        return {
          ...session,
          attempt_id: attemptId,
          test_id: testId,
        };
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  patchAttemptAnswers: async ({ attemptId, testId, changedAnswers }) => {
    try {
      const response = await httpClient.patch(`/attempts/${attemptId}/answers`, {
        answers: changedAnswers,
      });
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      if (!testId) {
        throw parsed;
      }

      try {
        await Promise.all(
          changedAnswers.map((item) =>
            httpClient.post(`/tests/${testId}/answer`, {
              submissionId: attemptId,
              questionId: item.question_id,
              selectedOption: item.selected_option ?? null,
              selectedOptions: item.selected_options ?? null,
              answerText: item.answer_text ?? null,
              answerBoolean: typeof item.answer_boolean === "boolean" ? item.answer_boolean : null,
              markedForReview: Boolean(item.marked_for_review),
            })
          )
        );

        return { saved: true };
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  submitAttempt: async ({ attemptId, testId, reason }) => {
    try {
      const response = await httpClient.post(`/attempts/${attemptId}/submit`, { reason });
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      if (!testId) {
        throw parsed;
      }

      try {
        const response = await httpClient.post(`/tests/${testId}/submit`, {
          submissionId: attemptId,
          reason,
        });
        return response.data;
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  heartbeatAttempt: async ({ attemptId, testId }) => {
    try {
      const response = await httpClient.patch(`/attempts/${attemptId}/heartbeat`, {});
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      if (!testId) {
        throw parsed;
      }

      try {
        await studentApi.getTestSession(testId);
        return { ok: true };
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },
 
  reportAttemptViolation: async ({ attemptId, testId, type, metadata }) => {
    try {
      const response = await httpClient.post(`/attempts/${attemptId}/violations`, {
        type,
        metadata,
      });
      return response.data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      if (!testId) {
        throw parsed;
      }

      try {
        const response = await httpClient.post(`/tests/${testId}/violation`, {
          submissionId: attemptId,
          type,
          metadata,
        });
        return response.data;
      } catch (legacyError) {
        throw toApiError(legacyError);
      }
    }
  },

  getAttemptResult: async (attemptId) => {
    try {
      const response = await httpClient.get(`/results/${attemptId}`);
      return withServerTime(response).data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallbackResponse = await httpClient.get(`/submission/${attemptId}`);
        return withServerTime(fallbackResponse).data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  getLeaderboard: async ({ view = "overall", test_id, department, page = 1, limit = 200 } = {}) => {
    const params = {
      view,
      page,
      limit,
    };

    if (test_id) {
      params.testId = test_id;
    }

    if (department) {
      params.departmentId = department;
    }

    try {
      const response = await httpClient.get("/leaderboard", { params });
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  getReports: async (filters = {}) => {
    const params = {
      view: filters?.view || "overall",
      test_id: filters?.test_id || undefined,
      date_from: filters?.date_from || undefined,
      date_to: filters?.date_to || undefined,
      topic: filters?.topic || undefined,
    };

    try {
      const response = await httpClient.get("/reports", { params });
      return withServerTime(response).data;
    } catch (error) {
      const parsed = toApiError(error);
      if (parsed.status !== 404) {
        throw parsed;
      }

      try {
        const fallbackResponse = await httpClient.get("/reports/overview", { params });
        return withServerTime(fallbackResponse).data;
      } catch (fallbackError) {
        throw toApiError(fallbackError);
      }
    }
  },

  exportReportsPdf: async (filters = {}) => {
    const payload = {
      view: filters?.view || "overall",
      test_id: filters?.test_id || undefined,
      date_from: filters?.date_from || undefined,
      date_to: filters?.date_to || undefined,
      topic: filters?.topic || undefined,
    };

    try {
      const response = await httpClient.post("/reports/export", payload);
      return withServerTime(response).data;
    } catch (error) {
      throw toApiError(error);
    }
  },

  getUpcomingTests: async () => {
    try {
      const response = await httpClient.get("/tests/upcoming");
      const { data, serverTime } = withServerTime(response);
      return {
        items: Array.isArray(data) ? data : [],
        serverTime,
      };
    } catch (error) {
      throw toApiError(error);
    }
  },

  getTestSession: async (testId) => {
    try {
      const response = await httpClient.get(`/tests/${testId}/session`);
      return response.data;
    } catch (error) {
      throw toApiError(error);
    }
  },
};
