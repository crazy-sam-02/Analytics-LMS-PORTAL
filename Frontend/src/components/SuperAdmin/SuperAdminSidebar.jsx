import { NavLink } from "react-router-dom";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { LayoutDashboard, School, ShieldUser, Users, Building2, FileCheck2, BookOpen, Layers3, CalendarDays, FileBarChart2, ChartNoAxesCombined, ScrollText, Settings, LogOut, Crown, ChevronLeft } from "lucide-react";
import { logoutSuperAdmin } from "@/features/SuperAdmin/superAdminAuthSlice";
import { toggleSidebar } from "@/features/SuperAdmin/superAdminUiSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";

const navItems = [
  { to: "/super-admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/super-admin/colleges", label: "Colleges", icon: School },
  { to: "/super-admin/admins", label: "Admins", icon: ShieldUser },
  { to: "/super-admin/students", label: "Students", icon: Users },
  { to: "/super-admin/departments", label: "Departments", icon: Building2 },
  { to: "/super-admin/tests", label: "Tests", icon: FileCheck2 },
  { to: "/super-admin/question-bank", label: "Question Bank", icon: BookOpen },
  { to: "/super-admin/batches", label: "Batches", icon: Layers3 },
  { to: "/super-admin/events", label: "Events", icon: CalendarDays },
  { to: "/super-admin/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/super-admin/audit-logs", label: "Audit Logs", icon: ScrollText },
  { to: "/super-admin/settings", label: "Settings", icon: Settings },
];

export default function SuperAdminSidebar() {
  const dispatch = useDispatch();
  const collapsed = useSelector((state) => state.superAdminUi?.sidebarCollapsed);
  const [logoutOpen, setLogoutOpen] = useState(false);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border bg-linear-to-b from-primary-dark to-sidebar py-5 text-sidebar-foreground transition-all duration-200 lg:flex lg:flex-col ${
        collapsed ? "w-16 px-2" : "w-64 px-4"
      }`}
    >
      <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        <div className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/40">
          <Crown className="size-5" />
        </div>
        {!collapsed ? (
          <div className="ml-3 flex-1">
            <p className="text-xl leading-none font-semibold tracking-tight text-sidebar-foreground">LMS Super</p>
            <p className="mt-1 text-[11px] tracking-wide text-sidebar-foreground/70 uppercase">Platform Control Center</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => dispatch(toggleSidebar())}
          className="grid size-8 place-items-center rounded-lg border border-sidebar-foreground/25 text-sidebar-foreground/80 hover:bg-sidebar-accent"
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className={`size-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
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
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm shadow-primary/35 ring-1 ring-sidebar-ring/30"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`
              }
              title={collapsed ? item.label : undefined}
            >
              <IconComponent className="size-4" strokeWidth={2.1} />
              {!collapsed ? item.label : null}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setLogoutOpen(true)}
        className="mt-auto flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/30 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent/50"
        title={collapsed ? "Logout" : undefined}
      >
        <LogOut className="size-4" />
        {!collapsed ? "Logout" : null}
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
