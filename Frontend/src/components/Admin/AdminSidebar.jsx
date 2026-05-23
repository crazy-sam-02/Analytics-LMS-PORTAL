import { NavLink } from "react-router-dom";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  LayoutDashboard,
  FileCheck2,
  LibraryBig,
  Layers3,
  Users,
  CalendarDays,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  PlusSquare,
} from "lucide-react";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { logoutAdmin } from "@/features/Admin/adminAuthSlice";
import { toggleSidebar } from "@/features/Admin/adminUiSlice";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";

const navItems = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/tests", label: "All Tests", icon: FileCheck2, permission: ADMIN_PERMISSIONS.EDIT_TEST },
  { to: "/admin/tests?create=1", label: "Create New", icon: PlusSquare, permission: ADMIN_PERMISSIONS.CREATE_TEST },
  { to: "/admin/question-bank", label: "Question Bank", icon: LibraryBig, permission: ADMIN_PERMISSIONS.MANAGE_QUESTIONS },
  { to: "/admin/batches", label: "Batches", icon: Layers3, permission: ADMIN_PERMISSIONS.MANAGE_BATCHES },
  { to: "/admin/students", label: "Students", icon: Users, permission: ADMIN_PERMISSIONS.MANAGE_STUDENTS },
  { to: "/admin/events", label: "Events", icon: CalendarDays, permission: ADMIN_PERMISSIONS.MANAGE_EVENTS },
  { to: "/admin/reports", label: "Reports", icon: BarChart3, permission: ADMIN_PERMISSIONS.VIEW_REPORTS },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminSidebar() {
  const dispatch = useDispatch();
  const collapsed = useSelector((state) => state.adminUi?.sidebarCollapsed);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const canEditTest = usePermission(ADMIN_PERMISSIONS.EDIT_TEST);
  const canManageQuestions = usePermission(ADMIN_PERMISSIONS.MANAGE_QUESTIONS);
  const canManageBatches = usePermission(ADMIN_PERMISSIONS.MANAGE_BATCHES);
  const canManageStudents = usePermission(ADMIN_PERMISSIONS.MANAGE_STUDENTS);
  const canManageEvents = usePermission(ADMIN_PERMISSIONS.MANAGE_EVENTS);
  const canViewReports = usePermission(ADMIN_PERMISSIONS.VIEW_REPORTS);

  const permissionMap = {
    [ADMIN_PERMISSIONS.EDIT_TEST]: canEditTest,
    [ADMIN_PERMISSIONS.MANAGE_QUESTIONS]: canManageQuestions,
    [ADMIN_PERMISSIONS.MANAGE_BATCHES]: canManageBatches,
    [ADMIN_PERMISSIONS.MANAGE_STUDENTS]: canManageStudents,
    [ADMIN_PERMISSIONS.MANAGE_EVENTS]: canManageEvents,
    [ADMIN_PERMISSIONS.VIEW_REPORTS]: canViewReports,
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border bg-linear-to-b from-primary-dark to-sidebar py-5 text-sidebar-foreground transition-all duration-200 lg:flex lg:flex-col ${
        collapsed ? "w-16 px-2" : "w-64 px-4"
      }`}
    >
      <div className={`mb-6 flex items-start gap-3 ${collapsed ? "justify-center" : "justify-between"}`}>
        <div className="flex min-w-0 flex-1 flex-col items-center rounded-2xl border border-white/10 bg-white/5 px-3 py-4 text-center shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] backdrop-blur-sm transition-transform hover:-translate-y-px">
          <img
            src="/ANALYTICS%20LOGO-%20FINAL.png"
            alt="Analytics Logo"
            className={`h-8 object-contain brightness-0 invert ${collapsed ? "w-10" : "w-full max-w-44"}`}
          />
          {!collapsed ? (
            <div className="mt-2 space-y-1">
              <p className="text-[15px] font-extrabold uppercase tracking-[0.35em] text-white ">
                Admin Portal
              </p>
              <p className="text-sm leading-5 text-sidebar-foreground/85">
                College control and test management
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="space-y-1.5">
        {navItems.filter((item) => !item.permission || permissionMap[item.permission]).map((item) => {
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
        title="Logout from Admin Portal"
        description="You will be signed out from this admin session and need to login again to continue."
        confirmLabel="Logout"
        confirmVariant="destructive"
        onConfirm={() => dispatch(logoutAdmin())}
      />
    </aside>
  );
}
