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
  Shield,
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
      <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        <div className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/40">
          <Shield className="size-5" />
        </div>
        {!collapsed ? (
          <div className="ml-3 flex-1">
            <p className="text-xl leading-none font-semibold tracking-tight text-sidebar-foreground">LMS Admin</p>
            <p className="mt-1 text-[11px] tracking-wide text-sidebar-foreground/70 uppercase">College Control Center</p>
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
