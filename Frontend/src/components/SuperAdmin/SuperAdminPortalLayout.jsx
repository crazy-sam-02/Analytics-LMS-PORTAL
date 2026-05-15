import { Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import SuperAdminSidebar from "@/components/SuperAdmin/SuperAdminSidebar";
import SuperAdminHeader from "@/components/SuperAdmin/SuperAdminHeader";
import ImpersonationBanner from "@/components/SuperAdmin/ImpersonationBanner";

export default function SuperAdminPortalLayout() {
  const sidebarCollapsed = useSelector((state) => state.superAdminUi?.sidebarCollapsed);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <SuperAdminSidebar />
      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <ImpersonationBanner />
        <SuperAdminHeader />
        <div className="p-4 sm:p-6 lg:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
