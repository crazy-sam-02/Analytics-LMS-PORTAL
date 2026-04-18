import { Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import AdminSidebar from "@/components/Admin/AdminSidebar";
import AdminHeader from "@/components/Admin/AdminHeader";

export default function AdminPortalLayout() {
  const sidebarCollapsed = useSelector((state) => state.adminUi?.sidebarCollapsed);

  return (
    <div className="min-h-screen bg-background lg:flex">
      <AdminSidebar />
      <main className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <AdminHeader />
        <div className="p-4 sm:p-6 lg:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
