import { Bell, Search } from "lucide-react";
import { useSelector } from "react-redux";
import { Input } from "@/components/ui/input";

export default function SuperAdminHeader() {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  const rawEnvironment = (import.meta.env.VITE_ENVIRONMENT || import.meta.env.MODE || "development").toUpperCase();
  const environment = rawEnvironment.includes("PROD") ? "PROD" : rawEnvironment.includes("STAG") ? "STAGING" : "DEV";
  const environmentTone = environment === "PROD"
    ? "border-red-200 bg-red-50 text-red-700"
    : environment === "STAGING"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">LMS Platform</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${environmentTone}`}>{environment}</span>
        </div>
        <p className="text-3xl leading-none font-semibold tracking-tight text-slate-900">
          Welcome, {superAdmin?.fullName?.split(" ")?.[0] || "Super Admin"}
        </p>
        <p className="mt-1 text-sm text-slate-500">Global command center for colleges, users, tests, and analytics</p>
      </div>

      <div className="ml-auto flex min-w-72 flex-1 items-center gap-3 sm:max-w-2xl">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <Search className="size-4 text-slate-400" />
          <Input
            type="text"
            placeholder="Search colleges, admins, tests"
            className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none ring-0 focus-visible:ring-0"
          />
        </div>

        <button type="button" className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500">
          <Bell className="size-5" />
        </button>
      </div>
    </header>
  );
}
