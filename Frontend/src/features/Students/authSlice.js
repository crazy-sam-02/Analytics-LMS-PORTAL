import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { setAccessToken } from "@/services/httpClient";
import { studentApi } from "@/services/studentApi";

const SESSION_KEY = "session_id";

const persistSessionId = (sessionId) => {
  try {
    if (sessionId) {
      localStorage.setItem(SESSION_KEY, sessionId);
      return;
    }

    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
};

const initialState = {
  accessToken: null,
  user: null,
  loading: false,
  initialized: false,
  error: null,
  accountInactive: false,
  sessionId: null,
  sessionConflict: false,
};

export const loginStudent = createAsyncThunk("auth/login", async (payload, { rejectWithValue }) => {
  try {
    const data = await studentApi.login(payload);
    setAccessToken(data.accessToken || null);
    persistSessionId(data.sessionId || null);
    return data;
  } catch (error) {
    if (error?.code === "ACCOUNT_INACTIVE" || error?.status === 403) {
      return rejectWithValue({
        accountInactive: true,
        message: error?.message || "Account is inactive",
      });
    }

    return rejectWithValue({
      accountInactive: false,
      message: error?.message || "Login failed",
    });
  }
});

export const refreshSession = createAsyncThunk("auth/refresh", async (_, { rejectWithValue }) => {
  try {
    const data = await studentApi.refreshSession();
    setAccessToken(data.accessToken || null);
    persistSessionId(data.sessionId || null);
    return data;
  } catch (error) {
    if (error?.code === "ACCOUNT_INACTIVE" || error?.status === 403) {
      return rejectWithValue({
        accountInactive: true,
        message: error?.message || "Account is inactive",
      });
    }

    return rejectWithValue({
      accountInactive: false,
      message: error?.message || "Session refresh failed",
    });
  }
});

export const fetchCurrentUser = createAsyncThunk("auth/me", async (_, { rejectWithValue }) => {
  try {
    return await studentApi.me();
  } catch (error) {
    return rejectWithValue({
      message: error?.message || "Unable to load profile",
    });
  }
});

export const logoutStudent = createAsyncThunk("auth/logout", async () => {
  try {
    await studentApi.logout();
  } finally {
    setAccessToken(null);
    persistSessionId(null);
  }

  return null;
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setSessionConflict: (state, action) => {
      state.sessionConflict = Boolean(action.payload);
    },
    accountInactiveDetected: (state) => {
      state.accountInactive = true;
      state.initialized = true;
      state.loading = false;
    },
    applyRefreshPayload: (state, action) => {
      const payload = action.payload || {};
      state.accessToken = payload.accessToken || null;
      state.user = payload.user || state.user;
      state.sessionId = payload.sessionId || state.sessionId;
      state.initialized = true;
      state.loading = false;
      state.accountInactive = false;
      state.error = null;
    },
    sessionExpired: (state) => {
      state.accessToken = null;
      state.user = null;
      state.loading = false;
      state.initialized = true;
      state.sessionId = null;
      state.sessionConflict = false;
      state.error = null;
    },
    markInitialized: (state) => {
      state.initialized = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginStudent.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loginStudent.fulfilled, (state, action) => {
        state.loading = false;
        state.accessToken = action.payload?.accessToken || null;
        state.user = action.payload?.user || null;
        state.sessionId = action.payload?.sessionId || null;
        state.accountInactive = false;
        state.error = null;
      })
      .addCase(loginStudent.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || action.error.message;
        state.accountInactive = Boolean(action.payload?.accountInactive);
      })
      .addCase(refreshSession.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(refreshSession.fulfilled, (state, action) => {
        state.loading = false;
        state.accessToken = action.payload?.accessToken || null;
        state.user = action.payload?.user || null;
        state.sessionId = action.payload?.sessionId || null;
        state.initialized = true;
        state.accountInactive = false;
        state.error = null;
      })
      .addCase(refreshSession.rejected, (state, action) => {
        state.loading = false;
        state.accessToken = null;
        state.user = null;
        state.initialized = true;
        state.sessionId = null;
        state.accountInactive = Boolean(action.payload?.accountInactive);
        state.error = action.payload?.message || action.error.message || null;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload || null;
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.error = action.payload?.message || action.error.message || state.error;
      })
      .addCase(logoutStudent.fulfilled, (state) => {
        state.accessToken = null;
        state.user = null;
        state.sessionId = null;
        state.sessionConflict = false;
        state.error = null;
      });
  },
});

export const { setSessionConflict, accountInactiveDetected, applyRefreshPayload, sessionExpired, markInitialized } = authSlice.actions;

export default authSlice.reducer;
