import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

export default function OfflineBanner() {
  const location = useLocation();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const inTestFlow = useMemo(() => {
    const path = location.pathname || "";
    return path.startsWith("/test/") || path.includes("/take");
  }, [location.pathname]);

  if (online) {
    return null;
  }

  return (
    <div
      className={`sticky top-0 z-100 border-b px-4 py-2 text-sm font-medium ${
        inTestFlow ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-800"
      }`}
      role="status"
    >
      {inTestFlow
        ? "You are offline. Test activity will sync once you reconnect. Do not close this page."
        : "You are offline. Changes will sync automatically when connection returns."}
    </div>
  );
}
