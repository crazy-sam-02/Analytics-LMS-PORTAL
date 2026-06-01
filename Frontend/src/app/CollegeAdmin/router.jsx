import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { fetchCurrentAdmin } from "@/features/Admin/adminAuthSlice";
import usePermission from "@/hooks/usePermission";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { isAdminRole, isCollegeAdminRole } from "@/features/Admin/adminRole";
import CollegeAdminPortalLayout from "@/components/CollegeAdmin/CollegeAdminPortalLayout";
import CollegeAdminLoginPage from "@/pages/CollegeAdmin/LoginPage";
import PasswordResetPage from "@/pages/Auth/PasswordResetPage";
import CollegeAdminDashboardPage from "@/pages/CollegeAdmin/DashboardPage";
import CollegeAdminTestsPage from "@/pages/CollegeAdmin/TestsPage";
import LiveMonitoringPage from "@/pages/Admin/LiveMonitoringPage";
import CollegeAdminQuestionBankPage from "@/pages/CollegeAdmin/QuestionBankPage";
import CollegeAdminBatchesPage from "@/pages/CollegeAdmin/BatchesPage";
import CollegeAdminStudentsPage from "@/pages/CollegeAdmin/StudentsPage";
import CollegeAdminEventsPage from "@/pages/CollegeAdmin/EventsPage";
import CollegeAdminReportsPage from "@/pages/CollegeAdmin/ReportsPage";
import CollegeAdminSettingsPage from "@/pages/CollegeAdmin/SettingsPage";
import DepartmentsManagementPage from "@/pages/CollegeAdmin/DepartmentsManagementPage";
import AdminManagementPage from "@/pages/CollegeAdmin/AdminManagementPage";
import CollegeAnalyticsPage from "@/pages/CollegeAdmin/CollegeAnalyticsPage";
import CollegeAdminLearningResourcesPage from "@/pages/CollegeAdmin/LearningResourcesPage";
import HardRedirect from "@/components/common/HardRedirect";
import { adminApi } from "@/services/api";

function PermissionRoute({ permission, action }) {
  const allowed = usePermission(permission);
  return allowed ? <Outlet /> : <PermissionDenied action={action} />;
}

function CollegeAdminBootstrap() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.adminAuth.initialized);

  useEffect(() => {
    dispatch(fetchCurrentAdmin());
  }, [dispatch]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing college admin session...</div>;
  }

  return <Outlet />;
}

function CollegeAdminProtectedRoute() {
  const admin = useSelector((state) => state.adminAuth.admin);
  if (!admin) {
    return <Navigate to="/college-admin/login" replace />;
  }
  if (isAdminRole(admin.role)) {
    return <HardRedirect to="/admin/dashboard" message="Redirecting to Admin portal..." />;
  }
  if (!isCollegeAdminRole(admin.role)) {
    return <Navigate to="/college-admin/login" replace />;
  }
  return <Outlet />;
}

function CollegeAdminPublicOnlyRoute() {
  const admin = useSelector((state) => state.adminAuth.admin);
  if (isCollegeAdminRole(admin?.role)) {
    return <Navigate to="/college-admin/dashboard" replace />;
  }
  if (isAdminRole(admin?.role)) {
    return <HardRedirect to="/admin/dashboard" message="Redirecting to Admin portal..." />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <CollegeAdminBootstrap />,
    children: [
      {
        element: <CollegeAdminPublicOnlyRoute />,
        children: [{ path: "/college-admin/login", element: <CollegeAdminLoginPage /> }],
      },
      {
        path: "/college-admin/forgot-password",
        element: (
          <PasswordResetPage
            portalName="College Admin"
            portalLabel="College admin workspace"
            loginPath="/college-admin/login"
            mainPath="/college-admin"
            requestReset={adminApi.forgotCollegeAdminPassword}
            completeReset={adminApi.resetCollegeAdminPassword}
          />
        ),
      },
      {
        path: "/college-admin/reset-password",
        element: (
          <PasswordResetPage
            portalName="College Admin"
            portalLabel="College admin workspace"
            loginPath="/college-admin/login"
            mainPath="/college-admin"
            requestReset={adminApi.forgotCollegeAdminPassword}
            completeReset={adminApi.resetCollegeAdminPassword}
          />
        ),
      },
      {
        element: <CollegeAdminProtectedRoute />,
        children: [
          {
            element: <CollegeAdminPortalLayout />,
            children: [
              { path: "/college-admin", element: <Navigate to="/college-admin/dashboard" replace /> },
              { path: "/college-admin/dashboard", element: <CollegeAdminDashboardPage /> },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_DEPARTMENTS} action="manage departments" />,
                children: [{ path: "/college-admin/departments", element: <DepartmentsManagementPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_ADMINS} action="manage admins" />,
                children: [{ path: "/college-admin/admins", element: <AdminManagementPage /> }],
              },
              { path: "/college-admin/tests", element: <CollegeAdminTestsPage /> },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.EDIT_TEST} action="monitor live tests" />,
                children: [{ path: "/college-admin/tests/:testId/monitoring", element: <LiveMonitoringPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_QUESTIONS} action="access question bank" />,
                children: [{ path: "/college-admin/question-bank", element: <CollegeAdminQuestionBankPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_RESOURCES} action="access learning resources" />,
                children: [{ path: "/college-admin/resources", element: <CollegeAdminLearningResourcesPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_BATCHES} action="manage batches" />,
                children: [{ path: "/college-admin/batches", element: <CollegeAdminBatchesPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_STUDENTS} action="manage students" />,
                children: [{ path: "/college-admin/students", element: <CollegeAdminStudentsPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_EVENTS} action="manage events" />,
                children: [{ path: "/college-admin/events", element: <CollegeAdminEventsPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_REPORTS} action="view reports" />,
                children: [{ path: "/college-admin/reports", element: <CollegeAdminReportsPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_ANALYTICS} action="view analytics" />,
                children: [{ path: "/college-admin/analytics", element: <CollegeAnalyticsPage /> }],
              },
              { path: "/college-admin/settings", element: <CollegeAdminSettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/college-admin/login" replace /> },
    ],
  },
]);

export default function CollegeAdminRouter() {
  return <RouterProvider router={router} />;
}
