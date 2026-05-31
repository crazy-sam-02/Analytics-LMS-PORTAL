import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import { fetchCurrentSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import SuperAdminPortalLayout from "@/components/SuperAdmin/SuperAdminPortalLayout";
import SuperAdminLoginPage from "@/pages/SuperAdmin/LoginPage";
import SuperAdminDashboardPage from "@/pages/SuperAdmin/DashboardPage";
import CollegesPage from "@/pages/SuperAdmin/CollegesPage";
import AdminsPage from "@/pages/SuperAdmin/AdminsPage";
import StudentsPage from "@/pages/SuperAdmin/StudentsPage";
import DepartmentsPage from "@/pages/SuperAdmin/DepartmentsPage";
import TestsPage from "@/pages/SuperAdmin/TestsPage";
import BatchesPage from "@/pages/SuperAdmin/BatchesPage";
import EventsPage from "@/pages/SuperAdmin/EventsPage";
import ReportsPage from "@/pages/SuperAdmin/ReportsPage";
import AnalyticsPage from "@/pages/SuperAdmin/AnalyticsPage";
import SettingsPage from "@/pages/SuperAdmin/SettingsPage";
import QuestionBankPage from "@/pages/SuperAdmin/QuestionBankPage";
import LearningResourcesPage from "@/pages/SuperAdmin/LearningResourcesPage";

function SuperAdminBootstrap() {
  const dispatch = useDispatch();
  const initialized = useSelector((state) => state.superAdminAuth.initialized);

  useEffect(() => {
    dispatch(fetchCurrentSuperAdmin());
  }, [dispatch]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing super admin session...</div>;
  }

  return <Outlet />;
}

function SuperAdminProtectedRoute() {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  return superAdmin ? <Outlet /> : <Navigate to="/super-admin/login" replace />;
}

function SuperAdminPublicOnlyRoute() {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  return superAdmin ? <Navigate to="/super-admin/dashboard" replace /> : <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <SuperAdminBootstrap />,
    children: [
      {
        element: <SuperAdminPublicOnlyRoute />,
        children: [{ path: "/super-admin/login", element: <SuperAdminLoginPage /> }],
      },
      {
        element: <SuperAdminProtectedRoute />,
        children: [
          {
            element: <SuperAdminPortalLayout />,
            children: [
              { path: "/super-admin", element: <Navigate to="/super-admin/dashboard" replace /> },
              { path: "/super-admin/dashboard", element: <SuperAdminDashboardPage /> },
              { path: "/super-admin/colleges", element: <CollegesPage /> },
              { path: "/super-admin/admins", element: <AdminsPage /> },
              { path: "/super-admin/students", element: <StudentsPage /> },
              { path: "/super-admin/departments", element: <DepartmentsPage /> },
              { path: "/super-admin/tests", element: <TestsPage /> },
              { path: "/super-admin/question-bank", element: <QuestionBankPage /> },
              { path: "/super-admin/resources", element: <LearningResourcesPage /> },
              { path: "/super-admin/batches", element: <BatchesPage /> },
              { path: "/super-admin/events", element: <EventsPage /> },
              { path: "/super-admin/reports", element: <ReportsPage /> },
              { path: "/super-admin/analytics", element: <AnalyticsPage /> },
              { path: "/super-admin/settings", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <Navigate to="/super-admin/login" replace /> },
    ],
  },
]);

export default function SuperAdminRouter() {
  return <RouterProvider router={router} />;
}
