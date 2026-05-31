import { configureStore } from "@reduxjs/toolkit";
import authReducer from "@/features/Students/authSlice";
import portalReducer from "@/features/Students/portalSlice";
import testReducer from "@/features/Students/testSlice";
import uiReducer from "@/features/Students/uiSlice";
import adminAuthReducer from "@/features/Admin/adminAuthSlice";
import adminDashboardReducer from "@/features/Admin/adminDashboardSlice";
import adminPanelReducer from "@/features/Admin/adminPanelSlice";
import testCreationReducer from "@/features/Admin/testCreationSlice";
import adminUiReducer from "@/features/Admin/adminUiSlice";
import questionBankReducer from "@/features/Admin/questionBankSlice";
import reportsReducer from "@/features/Admin/reportsSlice";
import superAdminAuthReducer from "@/features/SuperAdmin/superAdminAuthSlice";
import superAdminDashboardReducer from "@/features/SuperAdmin/superAdminDashboardSlice";
import superAdminPanelReducer from "@/features/SuperAdmin/superAdminPanelSlice";
import superAdminUiReducer from "@/features/SuperAdmin/superAdminUiSlice";
import superQuestionBankReducer from "@/features/SuperAdmin/superQuestionBankSlice";
import learningResourcesReducer from "@/features/LearningResources/learningResourcesSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    portal: portalReducer,
    test: testReducer,
    ui: uiReducer,
    adminAuth: adminAuthReducer,
    adminDashboard: adminDashboardReducer,
    adminPanel: adminPanelReducer,
    testCreation: testCreationReducer,
    adminUi: adminUiReducer,
    questionBank: questionBankReducer,
    reports: reportsReducer,
    superAdminAuth: superAdminAuthReducer,
    superAdminDashboard: superAdminDashboardReducer,
    superAdminPanel: superAdminPanelReducer,
    superAdminUi: superAdminUiReducer,
    superQuestionBank: superQuestionBankReducer,
    learningResources: learningResourcesReducer,
  },
});
