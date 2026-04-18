import { Suspense, lazy } from "react";
import AppErrorBoundary from "@/components/common/AppErrorBoundary";

const AppRouter = lazy(() => import("@/app/Students/router"));
const AdminRouter = lazy(() => import("@/app/Admin/router"));
const SuperAdminRouter = lazy(() => import("@/app/SuperAdmin/router"));

function App() {
  const isAdminPath = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const isSuperAdminPath = typeof window !== "undefined" && window.location.pathname.startsWith("/super-admin");

  return (
    <AppErrorBoundary>
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-slate-500">Loading...</div>}>
        {isSuperAdminPath ? <SuperAdminRouter /> : isAdminPath ? <AdminRouter /> : <AppRouter />}
      </Suspense>
    </AppErrorBoundary>
  );
}

export default App;