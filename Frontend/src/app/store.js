import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/Students/authSlice";
import portalReducer from "@/features/Students/portalSlice";
import testReducer from "@/features/Students/testSlice";
import uiReducer from "@/features/Students/uiSlice";
import notificationsReducer from "@/features/Students/notificationsSlice";
import adminAuthReducer from "@/features/Admin/adminAuthSlice";
import adminDashboardReducer from "@/features/Admin/adminDashboardSlice";
import adminPanelReducer from "@/features/Admin/adminPanelSlice";
import testCreationReducer from "@/features/Admin/testCreationSlice";
import adminUiReducer from "@/features/Admin/adminUiSlice";
import questionBankReducer from "@/features/Admin/questionBankSlice";
import superAdminAuthReducer from "@/features/SuperAdmin/superAdminAuthSlice";
import superAdminDashboardReducer from "@/features/SuperAdmin/superAdminDashboardSlice";
import superAdminPanelReducer from "@/features/SuperAdmin/superAdminPanelSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    portal: portalReducer,
    test: testReducer,
    ui: uiReducer,
    notifications: notificationsReducer,
    adminAuth: adminAuthReducer,
    adminDashboard: adminDashboardReducer,
    adminPanel: adminPanelReducer,
    testCreation: testCreationReducer,
    adminUi: adminUiReducer,
    questionBank: questionBankReducer,
    superAdminAuth: superAdminAuthReducer,
    superAdminDashboard: superAdminDashboardReducer,
    superAdminPanel: superAdminPanelReducer,
  },
});
