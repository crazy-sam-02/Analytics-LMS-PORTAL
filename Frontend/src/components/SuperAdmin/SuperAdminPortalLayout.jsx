import { Outlet } from "react-router-dom";
import SuperAdminSidebar from "@/components/SuperAdmin/SuperAdminSidebar";
import SuperAdminHeader from "@/components/SuperAdmin/SuperAdminHeader";
import ImpersonationBanner from "@/components/SuperAdmin/ImpersonationBanner";

export default function SuperAdminPortalLayout() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-100 via-slate-50 to-blue-50 lg:flex">
      <SuperAdminSidebar />
      <main className="flex-1">
        <ImpersonationBanner />
        <SuperAdminHeader />
        <div className="p-4 sm:p-6 lg:p-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
