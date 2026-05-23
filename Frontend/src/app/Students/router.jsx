import { Suspense, lazy, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import {
  accountInactiveDetected,
  applyRefreshPayload,
  logoutStudent,
  markInitialized,
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
import ResumeAttemptPage from "@/pages/Students/ResumeAttemptPage";
import { registerAuthInterceptorHandlers } from "@/services/httpClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const STUDENT_ACCESS_TOKEN_KEY = "student_access_token";
const STUDENT_REFRESH_TOKEN_KEY = "student_refresh_token";
const STUDENT_SESSION_ID_KEY = "student_session_id";
const LEGACY_SESSION_KEY = "session_id";
const STUDENT_USER_KEY = "student_user";

const safeWriteStorage = (key, value) => {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

const safeWriteSessionStorage = (key, value) => {
  try {
    if (value === null || value === undefined || value === "") {
      sessionStorage.removeItem(key);
      return;
    }

    sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
};

const persistStudentAuth = (payload = {}) => {
  safeWriteStorage(STUDENT_ACCESS_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_ACCESS_TOKEN_KEY, payload.accessToken || null);
  if (payload.refreshToken !== undefined) {
    safeWriteStorage(STUDENT_REFRESH_TOKEN_KEY, payload.refreshToken || null);
    safeWriteSessionStorage(STUDENT_REFRESH_TOKEN_KEY, payload.refreshToken || null);
  }
  safeWriteStorage(STUDENT_SESSION_ID_KEY, payload.sessionId || null);
  safeWriteStorage(LEGACY_SESSION_KEY, payload.sessionId || null);
  safeWriteStorage(STUDENT_USER_KEY, payload.user ? JSON.stringify(payload.user) : null);
};

const clearStudentAuth = () => {
  safeWriteStorage(STUDENT_ACCESS_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_ACCESS_TOKEN_KEY, null);
  safeWriteStorage(STUDENT_REFRESH_TOKEN_KEY, null);
  safeWriteSessionStorage(STUDENT_REFRESH_TOKEN_KEY, null);
  safeWriteStorage(STUDENT_SESSION_ID_KEY, null);
  safeWriteStorage(LEGACY_SESSION_KEY, null);
  safeWriteStorage(STUDENT_USER_KEY, null);
};

const TestEnvironmentPage = lazy(() => import("@/pages/Students/TestEnvironmentPage"));
const EventsPage = lazy(() => import("@/pages/Students/EventsPage"));
const ProfilePage = lazy(() => import("@/pages/Students/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/Students/SettingsPage"));

function PageRoute({ children }) {
  return <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-text-secondary">Loading...</div>}>{children}</Suspense>;
}

function TestEnvironmentRoute() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading secure test environment...</div>}>
      <TestEnvironmentPage />
    </Suspense>
  );
}

function AuthBootstrap() {
  const dispatch = useDispatch();
  const { initialized, accountInactive, sessionConflict, sessionId, user, accessToken } = useSelector((state) => state.auth);

  useEffect(() => {
    if (accessToken) {
      dispatch(markInitialized());
      return;
    }

    dispatch(refreshSession());
  }, [accessToken, dispatch]);

  useEffect(() => {
    registerAuthInterceptorHandlers({
      onRefreshSuccess: (payload) => {
        persistStudentAuth(payload || {});
        dispatch(applyRefreshPayload(payload));
      },
      onRefreshFailure: (_error, options = {}) => {
        if (!options?.forceLogout) {
          return;
        }

        clearStudentAuth();
        dispatch(sessionExpired());
      },
      onAccountInactive: () => {
        dispatch(accountInactiveDetected());
      },
    });
  }, [dispatch]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== STUDENT_SESSION_ID_KEY && event.key !== LEGACY_SESSION_KEY) {
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
    return <div className="grid min-h-screen place-items-center text-text-secondary">Initializing...</div>;
  }

  if (accountInactive) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted p-6">
        <div className="w-full max-w-xl rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-text-primary">Account Access Blocked</h1>
          <p className="mt-3 text-sm text-text-secondary">
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
      {sessionConflict ? (
        <Dialog open={sessionConflict} onOpenChange={(open) => dispatch(setSessionConflict(open))}>
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
      ) : null}
    </>
  );
}

function ProtectedRoute() {
  const user = useSelector((state) => state.auth.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function PublicOnlyRoute() {
  const user = useSelector((state) => state.auth.user);
  return user ? <Navigate to="/resume" replace /> : <Outlet />;
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
              { path: "/", element: <Navigate to="/resume" replace /> },
              { path: "/resume", element: <ResumeAttemptPage /> },
              { path: "/tests", element: <MyTestsPage /> },
              { path: "/tests/ongoing", element: <OngoingTestsPage /> },
              { path: "/tests/upcoming", element: <UpcomingTestsPage /> },
              { path: "/reports", element: <ReportsPage /> },
              { path: "/leaderboard", element: <LeaderboardPage /> },
              { path: "/events", element: <PageRoute><EventsPage /></PageRoute> },
              { path: "/profile", element: <PageRoute><ProfilePage /></PageRoute> },
              { path: "/settings", element: <PageRoute><SettingsPage /></PageRoute> },
                { path: "/results/:attemptId", element: <ResultsPage /> },
            ],
          },
          { path: "/tests/:testId/take", element: <TestEnvironmentRoute /> },
          { path: "/test/:attemptId", element: <TestEnvironmentRoute /> },
          { path: "/submission/:submissionId", element: <SubmissionPage /> },
        ],
      },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
