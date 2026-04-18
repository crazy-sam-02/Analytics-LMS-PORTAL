import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { studentApi } from "@/services/studentApi";

const initialState = {
  items: [],
  unreadCount: 0,
  page: 1,
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null,
};

export const fetchUnreadNotifications = createAsyncThunk(
  "notifications/fetchUnread",
  async ({ page = 1 } = {}, { rejectWithValue }) => {
    try {
      const data = await studentApi.getUnreadNotifications({ page, limit: 20 });
      return {
        ...data,
        page,
      };
    } catch (error) {
      return rejectWithValue({
        message: error?.message || "Unable to load notifications",
      });
    }
  }
);

export const markNotificationAsRead = createAsyncThunk(
  "notifications/markOne",
  async ({ notificationId }, { rejectWithValue }) => {
    try {
      await studentApi.markNotificationRead(notificationId);
      return { notificationId };
    } catch (error) {
      return rejectWithValue({
        message: error?.message || "Unable to mark notification as read",
      });
    }
  }
);

export const markAllNotificationsAsRead = createAsyncThunk(
  "notifications/markAll",
  async (_, { rejectWithValue }) => {
    try {
      await studentApi.markAllNotificationsRead();
      return true;
    } catch (error) {
      return rejectWithValue({
        message: error?.message || "Unable to mark all notifications as read",
      });
    }
  }
);

const notificationsSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    pushNotification: (state, action) => {
      const notification = {
        id: crypto.randomUUID(),
        type: action.payload?.type || "info",
        message: action.payload?.message || "",
        createdAt: Date.now(),
      };

      state.items.unshift(notification);
      if (state.items.length > 100) {
        state.items.length = 100;
      }
      state.unreadCount = state.items.length;
    },
    dismissNotification: (state, action) => {
      state.items = state.items.filter((item) => item.id !== action.payload);
      state.unreadCount = state.items.length;
    },
    clearNotifications: (state) => {
      state.items = [];
      state.unreadCount = 0;
      state.page = 1;
      state.hasMore = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUnreadNotifications.pending, (state, action) => {
        const page = Number(action.meta?.arg?.page || 1);
        state.error = null;

        if (page > 1) {
          state.loadingMore = true;
        } else {
          state.loading = true;
        }
      })
      .addCase(fetchUnreadNotifications.fulfilled, (state, action) => {
        const incoming = Array.isArray(action.payload?.items) ? action.payload.items : [];
        const page = Number(action.payload?.page || 1);

        if (page > 1) {
          const existing = new Set(state.items.map((item) => String(item.id)));
          state.items = [...state.items, ...incoming.filter((item) => !existing.has(String(item?.id)))];
        } else {
          state.items = incoming;
        }

        state.unreadCount = state.items.length;
        state.page = page;
        state.hasMore = Boolean(action.payload?.hasMore);
        state.loading = false;
        state.loadingMore = false;
      })
      .addCase(fetchUnreadNotifications.rejected, (state, action) => {
        state.loading = false;
        state.loadingMore = false;
        state.error = action.payload?.message || action.error?.message || "Unable to load notifications";
      })
      .addCase(markNotificationAsRead.fulfilled, (state, action) => {
        const targetId = String(action.payload?.notificationId || "");
        state.items = state.items.filter((item) => String(item.id) !== targetId);
        state.unreadCount = state.items.length;
      })
      .addCase(markAllNotificationsAsRead.fulfilled, (state) => {
        state.items = [];
        state.unreadCount = 0;
        state.hasMore = false;
      });
  },
});

export const { pushNotification, dismissNotification, clearNotifications } = notificationsSlice.actions;

export default notificationsSlice.reducer;
