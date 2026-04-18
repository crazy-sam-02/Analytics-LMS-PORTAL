import { memo, useMemo } from "react";
import { Outlet } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import Header from "@/components/Studetns/Header";
import Sidebar from "@/components/Studetns/Sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { setMobileSidebarOpen, toggleSidebar } from "@/features/Students/uiSlice";
import { upcomingTestsQueryOptions } from "@/services/studentQueries";

function AppShell() {
  const dispatch = useDispatch();
  const sidebarCollapsed = useSelector((state) => state.ui.sidebarCollapsed);
  const mobileSidebarOpen = useSelector((state) => state.ui.mobileSidebarOpen);

  const { data: upcomingPayload } = useQuery(upcomingTestsQueryOptions());

  const upcomingCount = useMemo(() => {
    const items = Array.isArray(upcomingPayload?.items) ? upcomingPayload.items : [];
    const uniqueIds = new Set(items.map((item) => item?.id || item?.test_id).filter(Boolean));
    return uniqueIds.size;
  }, [upcomingPayload]);

  const sidebarWidthClass = sidebarCollapsed ? "lg:w-12" : "lg:w-60";

  return (
    <div className="min-h-screen bg-[#f2f5fb] lg:flex">
      <aside className={`hidden shrink-0 lg:block ${sidebarWidthClass}`}>
        <Sidebar collapsed={sidebarCollapsed} upcomingCount={upcomingCount} />
      </aside>

      <Sheet open={mobileSidebarOpen} onOpenChange={(open) => dispatch(setMobileSidebarOpen(open))}>
        <SheetContent side="left" className="w-72 sm:w-80 p-0" showCloseButton={false}>
          <Sidebar
            mobile
            collapsed={false}
            upcomingCount={upcomingCount}
            onNavigate={() => dispatch(setMobileSidebarOpen(false))}
          />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1">
        <Header
          collapsed={sidebarCollapsed}
          onToggleSidebar={() => dispatch(toggleSidebar())}
          onOpenMobileSidebar={() => dispatch(setMobileSidebarOpen(true))}
        />
        <div className="p-3 sm:p-6 lg:p-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default memo(AppShell);
