import { memo } from "react";
import { PanelLeftClose, PanelLeftOpen, Menu } from "lucide-react";
import { useSelector } from "react-redux";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/Studetns/NotificationBell";
import { optimizeCloudinaryImage } from "@/lib/cloudinary";

function Header({ collapsed, onToggleSidebar, onOpenMobileSidebar }) {
  const user = useSelector((state) => state.auth.user);

  return (
    <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-3 sm:gap-3 sm:px-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileSidebar}>
          <Menu className="size-4" />
          <span className="sr-only">Open menu</span>
        </Button>

        <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onToggleSidebar}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className="sr-only">Toggle sidebar</span>
        </Button>

        <div>
          <p className="text-base leading-none font-semibold tracking-tight text-[#0f1f36] sm:text-xl">Hello, {user?.fullName?.split(" ")?.[0] || "Student"}</p>
          <p className="mt-1 hidden text-xs text-slate-500 sm:block sm:text-sm">Focused mode for your tests and analytics</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <NotificationBell />

        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-1.5 py-1 sm:px-2 sm:py-1.5 shadow-sm">
          <Avatar size="default" className="size-8 rounded-lg bg-blue-100 text-blue-700 after:hidden">
            <AvatarImage
              src={optimizeCloudinaryImage(user?.avatarUrl, { width: 64, height: 64, gravity: "face" })}
              alt={user?.fullName || "Student avatar"}
              className="rounded-lg object-cover"
            />
            <AvatarFallback className="rounded-lg bg-blue-100 text-xs font-bold text-blue-700">
              {(user?.fullName || "ST")
                .split(" ")
                .slice(0, 2)
                .map((part) => part[0])
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div className="hidden pr-1 sm:block">
            <p className="text-sm font-semibold text-slate-800">{user?.fullName || "Student"}</p>
            <p className="text-[11px] text-slate-500">{user?.studentId || "---"}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

export default memo(Header);
