import { Suspense, lazy } from "react";
import AppErrorBoundary from "@/components/common/AppErrorBoundary";

const AppRouter = lazy(() => import("@/app/Students/router"));
const AdminRouter = lazy(() => import("@/app/Admin/router"));
const CollegeAdminRouter = lazy(() => import("@/app/CollegeAdmin/router"));
const SuperAdminRouter = lazy(() => import("@/app/SuperAdmin/router"));

function App() {
  const isAdminPath = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const isCollegeAdminPath = typeof window !== "undefined" && window.location.pathname.startsWith("/college-admin");
  const isSuperAdminPath = typeof window !== "undefined" && window.location.pathname.startsWith("/super-admin");

  return (
    <AppErrorBoundary>
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-text-secondary">Loading...</div>}>
        {isSuperAdminPath
          ? <SuperAdminRouter />
          : isCollegeAdminPath
            ? <CollegeAdminRouter />
            : isAdminPath
              ? <AdminRouter />
              : <AppRouter />}
      </Suspense>
    </AppErrorBoundary>
  );
}

export default App;
