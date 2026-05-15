import { Bell, Search } from "lucide-react";
import { useSelector } from "react-redux";
import { Input } from "@/components/ui/input";

export default function SuperAdminHeader() {
  const superAdmin = useSelector((state) => state.superAdminAuth.superAdmin);
  const rawEnvironment = (import.meta.env.VITE_ENVIRONMENT || import.meta.env.MODE || "development").toUpperCase();
  const environment = rawEnvironment.includes("PROD") ? "PROD" : rawEnvironment.includes("STAG") ? "STAGING" : "DEV";
  const environmentTone = environment === "PROD"
    ? "border-danger/30 bg-danger/10 text-danger"
    : environment === "STAGING"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-primary/30 bg-primary/10 text-primary";

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-5 py-4">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-text-secondary uppercase">LMS Platform</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${environmentTone}`}>{environment}</span>
        </div>
        <p className="text-3xl leading-none font-semibold tracking-tight text-text-primary">
          Welcome, {superAdmin?.fullName?.split(" ")?.[0] || "Super Admin"}
        </p>
        <p className="mt-1 text-sm text-text-secondary">Global command center for colleges, users, tests, and analytics</p>
      </div>
    </header>
  );
}
