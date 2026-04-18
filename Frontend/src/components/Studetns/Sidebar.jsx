import { memo } from "react";
import { Link, NavLink } from "react-router-dom";
import { useDispatch } from "react-redux";
import { BarChart3, CalendarDays, FileText, Medal, Settings, User, PlayCircle, Clock3, LogOut } from "lucide-react";
import { logoutStudent } from "@/features/Students/authSlice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/tests/ongoing", label: "Ongoing Tests", icon: PlayCircle },
  { to: "/tests/upcoming", label: "Upcoming Tests", icon: Clock3 },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/leaderboard", label: "Leaderboard", icon: Medal },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/profile", label: "Profile", icon: User },
];

function Sidebar({ collapsed, mobile = false, onNavigate, upcomingCount = 0 }) {
  const dispatch = useDispatch();
  const shellWidthClass = collapsed ? "w-12" : "w-60";

  return (
    <aside className={`flex h-full flex-col border-r border-slate-200 bg-white px-2 py-4 ${mobile ? "w-full max-w-80" : shellWidthClass}`}>
      <Link to="/tests/ongoing" onClick={onNavigate} className="mb-6 flex items-center gap-2 px-1">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-blue-700 text-white shadow-lg shadow-blue-700/25">
          <BarChart3 className="size-4" />
        </div>
        {!collapsed ? (
          <div>
            <p className="text-lg leading-none font-semibold tracking-tight text-[#0e3b78]">Analytica</p>
            <p className="mt-1 text-[10px] tracking-wide text-slate-500 uppercase">Student Portal</p>
          </div>
        ) : null}
      </Link>

      <nav className="space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `group flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            <item.icon className="size-4 shrink-0" strokeWidth={2.2} />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
            {!collapsed && item.to === "/tests/upcoming" ? (
              <Badge variant="secondary" className="ml-auto bg-slate-200/70 text-[10px] font-semibold text-slate-700">
                {upcomingCount}
              </Badge>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-2.5 pt-6">
        <Button
          type="button"
          onClick={() => dispatch(logoutStudent())}
          variant="outline"
          className={`h-10 w-full rounded-lg text-slate-600 hover:bg-slate-50 ${collapsed ? "px-0" : ""}`}
        >
          <LogOut className="size-4" />
          {!collapsed ? "Logout" : null}
        </Button>
      </div>
    </aside>
  );
}

export default memo(Sidebar);
