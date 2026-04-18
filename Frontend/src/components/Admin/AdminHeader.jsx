import { Bell, Search, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import AdminCommandPalette from "@/components/Admin/AdminCommandPalette";

export default function AdminHeader() {
  const navigate = useNavigate();
  const admin = useSelector((state) => state.adminAuth.admin);
  const [searchOpen, setSearchOpen] = useState(false);
  const college = admin?.college;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-muted text-text-primary">
            {(college?.name || "C").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-lg leading-none font-semibold tracking-tight text-text-primary">{college?.name || "Your College"}</p>
            <p className="mt-1 text-xs text-text-secondary">{college?.code || "-"} • Admin Workspace</p>
          </div>
        </div>

        <div className="ml-auto flex min-w-72 flex-1 items-center gap-3 sm:max-w-2xl">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm text-text-secondary"
          >
            <Search className="size-4 text-text-secondary" />
            <span>Search tests, students, batches</span>
            <span className="ml-auto rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">Ctrl+K</span>
          </button>

          <button type="button" className="grid size-10 place-items-center rounded-xl border border-border bg-card text-text-secondary hover:bg-muted">
            <Bell className="size-5" />
          </button>

          <Button type="button" variant="outline" size="sm" onClick={() => navigate("/admin/tests")}>All Tests</Button>
          <Button type="button" size="sm" onClick={() => navigate("/admin/tests?create=1")}>Quick Action</Button>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
            <Avatar className="size-8 rounded-lg bg-primary/10 text-primary after:hidden">
              <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-bold text-primary">
                {(admin?.fullName || "AD")
                  .split(" ")
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="pr-1">
              <p className="text-sm font-semibold text-text-primary">{admin?.fullName || "Admin"}</p>
              <p className="text-[11px] text-text-secondary">{admin?.employeeId || "---"}</p>
            </div>
            <ChevronDown className="size-4 text-text-secondary" />
          </div>
        </div>
      </header>

      <AdminCommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
