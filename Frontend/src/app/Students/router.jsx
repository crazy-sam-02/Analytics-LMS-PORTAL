import { Suspense, lazy, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import {
  accountInactiveDetected,
  applyRefreshPayload,
  logoutStudent,
  refreshSession,
  sessionExpired,
  setSessionConflict,
} from "@/features/Students/authSlice";
import AppShell from "@/components/Studetns/AppShell";
import OfflineBanner from "@/components/common/OfflineBanner";
import LoginPage from "@/pages/Students/LoginPage";
import MyTestsPage from "@/pages/Students/MyTestsPage";
import OngoingTestsPage from "@/pages/Students/OngoingTestsPage";
import UpcomingTestsPage from "@/pages/Students/UpcomingTestsPage";
import ReportsPage from "@/pages/Students/ReportsPage";
import LeaderboardPage from "@/pages/Students/LeaderboardPage";
import SubmissionPage from "@/pages/Students/SubmissionPage";
import ResultsPage from "@/pages/Students/ResultsPage";
import { registerAuthInterceptorHandlers } from "@/services/httpClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const TestEnvironmentPage = lazy(() => import("@/pages/Students/TestEnvironmentPage"));
const EventsPage = lazy(() => import("@/pages/Students/EventsPage"));
const ProfilePage = lazy(() => import("@/pages/Students/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/Students/SettingsPage"));

function PageRoute({ children }) {
  return <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-slate-500">Loading...</div>}>{children}</Suspense>;
}

function TestEnvironmentRoute() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-slate-500">Loading secure test environment...</div>}>
      <TestEnvironmentPage />
    </Suspense>
  );
}

function AuthBootstrap() {
  const dispatch = useDispatch();
  const { initialized, accountInactive, sessionConflict, sessionId, user } = useSelector((state) => state.auth);

  useEffect(() => {
    dispatch(refreshSession());
  }, [dispatch]);

  useEffect(() => {
    registerAuthInterceptorHandlers({
      onRefreshSuccess: (payload) => {
        try {
          if (payload?.sessionId) {
            localStorage.setItem("session_id", payload.sessionId);
          }
        } catch {
          // Ignore storage failures.
        }
        dispatch(applyRefreshPayload(payload));
      },
      onRefreshFailure: () => {
        try {
          localStorage.removeItem("session_id");
        } catch {
          // Ignore storage failures.
        }
        dispatch(sessionExpired());
      },
      onAccountInactive: () => {
        dispatch(accountInactiveDetected());
      },
    });
  }, [dispatch]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== "session_id") {
        return;
      }

      if (!user || !sessionId) {
        return;
      }

      if (event.newValue && event.newValue !== sessionId) {
        dispatch(setSessionConflict(true));
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [dispatch, sessionId, user]);

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center text-slate-500">Initializing...</div>;
  }

  if (accountInactive) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Account Access Blocked</h1>
          <p className="mt-3 text-sm text-slate-600">
            Your account is currently inactive. Please contact your institution administrator to reactivate access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <OfflineBanner />
      <Outlet />
      <Dialog open={sessionConflict}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Session changed in another tab</DialogTitle>
            <DialogDescription>
              Your session was updated elsewhere. Please continue with the latest session or logout.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-end">
            <Button variant="outline" onClick={() => dispatch(setSessionConflict(false))}>Continue Here</Button>
            <Button onClick={() => dispatch(logoutStudent())}>Logout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProtectedRoute() {
  const user = useSelector((state) => state.auth.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  const user = useSelector((state) => state.auth.user);
  return user ? <Navigate to="/tests/ongoing" replace /> : <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <AuthBootstrap />,
    children: [
      {
        element: <PublicOnlyRoute />,
        children: [{ path: "/login", element: <LoginPage /> }],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "/", element: <Navigate to="/tests/ongoing" replace /> },
              { path: "/tests", element: <MyTestsPage /> },
              { path: "/tests/ongoing", element: <OngoingTestsPage /> },
              { path: "/tests/upcoming", element: <UpcomingTestsPage /> },
              { path: "/reports", element: <ReportsPage /> },
              { path: "/leaderboard", element: <LeaderboardPage /> },
              { path: "/events", element: <PageRoute><EventsPage /></PageRoute> },
              { path: "/profile", element: <PageRoute><ProfilePage /></PageRoute> },
              { path: "/settings", element: <PageRoute><SettingsPage /></PageRoute> },
            ],
          },
          { path: "/tests/:testId/take", element: <TestEnvironmentRoute /> },
          { path: "/test/:attemptId", element: <TestEnvironmentRoute /> },
          { path: "/submission/:submissionId", element: <SubmissionPage /> },
          { path: "/results/:attemptId", element: <ResultsPage /> },
        ],
      },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
