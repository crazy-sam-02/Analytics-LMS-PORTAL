import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { fetchCurrentAdmin } from "@/features/Admin/adminAuthSlice";
import AdminPortalLayout from "@/components/Admin/AdminPortalLayout";
import AdminLoginPage from "@/pages/Admin/LoginPage";
import AdminDashboardPage from "@/pages/Admin/DashboardPage";
import ManageTestsPage from "@/pages/Admin/ManageTestsPage";
import QuestionBankPage from "@/pages/Admin/QuestionBankPage";
import BatchesPage from "@/pages/Admin/BatchesPage";
import StudentsPage from "@/pages/Admin/StudentsPage";
import EventsPage from "@/pages/Admin/EventsPage";
import ReportsPage from "@/pages/Admin/ReportsPage";
import AdminSettingsPage from "@/pages/Admin/SettingsPage";
import LearningResourcesPage from "@/pages/Admin/LearningResourcesPage";
import usePermission from "@/hooks/usePermission";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { isCollegeAdminRole } from "@/features/Admin/adminRole";
import HardRedirect from "@/components/common/HardRedirect";

function PermissionRoute({ permission, action }) {
  const allowed = usePermission(permission);
  return allowed ? <Outlet /> : <PermissionDenied action={action} />;
}

function AdminAuthBootstrap() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.adminAuth.initialized);

  useEffect(() => {
    dispatch(fetchCurrentAdmin());
  }, [dispatch]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing admin session...</div>;
  }

  return <Outlet />;
}

function AdminProtectedRoute() {
  const admin = useSelector((state) => state.adminAuth.admin);
  if (!admin) {
    return <Navigate to="/admin/login" replace />;
  }
  if (isCollegeAdminRole(admin.role)) {
    return <HardRedirect to="/college-admin/dashboard" message="Redirecting to College Admin portal..." />;
  }
  return <Outlet />;
}

function AdminPublicOnlyRoute() {
  const admin = useSelector((state) => state.adminAuth.admin);
  if (!admin) {
    return <Outlet />;
  }
  if (isCollegeAdminRole(admin.role)) {
    return <HardRedirect to="/college-admin/dashboard" message="Redirecting to College Admin portal..." />;
  }
  return <Navigate to="/admin/dashboard" replace />;
}

const router = createBrowserRouter([
  {
    element: <AdminAuthBootstrap />,
    children: [
      {
        element: <AdminPublicOnlyRoute />,
        children: [{ path: "/admin/login", element: <AdminLoginPage /> }],
      },
      {
        element: <AdminProtectedRoute />,
        children: [
          {
            element: <AdminPortalLayout />,
            children: [
              { path: "/admin", element: <Navigate to="/admin/dashboard" replace /> },
              { path: "/admin/dashboard", element: <AdminDashboardPage /> },
              { path: "/admin/tests", element: <ManageTestsPage /> },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_QUESTIONS} action="access question bank" />,
                children: [{ path: "/admin/question-bank", element: <QuestionBankPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_RESOURCES} action="access learning resources" />,
                children: [{ path: "/admin/resources", element: <LearningResourcesPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_BATCHES} action="manage batches" />,
                children: [{ path: "/admin/batches", element: <BatchesPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_STUDENTS} action="manage students" />,
                children: [{ path: "/admin/students", element: <StudentsPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.MANAGE_EVENTS} action="manage events" />,
                children: [{ path: "/admin/events", element: <EventsPage /> }],
              },
              {
                element: <PermissionRoute permission={ADMIN_PERMISSIONS.VIEW_REPORTS} action="view reports" />,
                children: [{ path: "/admin/reports", element: <ReportsPage /> }],
              },
              { path: "/admin/settings", element: <AdminSettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/admin/login" replace /> },
    ],
  },
]);

export default function AdminRouter() {
  return <RouterProvider router={router} />;
}
