import { NavLink } from "react-router-dom";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { LayoutDashboard, School, ShieldUser, Users, Building2, FileCheck2, Layers3, CalendarDays, FileBarChart2, ChartNoAxesCombined, ScrollText, Settings, LogOut, Crown } from "lucide-react";
import { logoutSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";

const navItems = [
  { to: "/super-admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/super-admin/colleges", label: "Colleges", icon: School },
  { to: "/super-admin/admins", label: "Admins", icon: ShieldUser },
  { to: "/super-admin/students", label: "Students", icon: Users },
  { to: "/super-admin/departments", label: "Departments", icon: Building2 },
  { to: "/super-admin/tests", label: "Tests", icon: FileCheck2 },
  { to: "/super-admin/batches", label: "Batches", icon: Layers3 },
  { to: "/super-admin/events", label: "Events", icon: CalendarDays },
  { to: "/super-admin/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/super-admin/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/super-admin/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/super-admin/settings", label: "Settings", icon: Settings },
];

export default function SuperAdminSidebar() {
  const dispatch = useDispatch();
  const [logoutOpen, setLogoutOpen] = useState(false);

  return (
    <aside className="flex w-full max-w-72 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:h-screen">
      <div className="mb-8 flex items-center gap-3 px-1">
        <div className="grid size-10 place-items-center rounded-xl bg-blue-500 text-white shadow-lg shadow-blue-500/30">
          <Crown className="size-5" />
        </div>
        <div>
          <p className="text-2xl leading-none font-semibold tracking-tight text-slate-900">LMS Super</p>
          <p className="mt-1 text-[11px] tracking-wide text-slate-500 uppercase">Platform Control Center</p>
        </div>
      </div>

      <nav className="space-y-1.5">
        {navItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <IconComponent className="size-4" strokeWidth={2.1} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setLogoutOpen(true)}
        className="mt-auto flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 transition hover:bg-slate-50"
      >
        <LogOut className="size-4" />
        Logout
      </button>

      <ConfirmActionDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Logout from Super Admin Portal"
        description="You will be signed out from this super admin session and need to login again to continue."
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(logoutSuperAdmin())}
      />
    </aside>
  );
}
