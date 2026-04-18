import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";

export default function AuditLogsPage() {
  const [action, setAction] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", String(limit));
    if (action.trim()) query.set("action", action.trim());
    if (startDate) query.set("startDate", new Date(startDate).toISOString());
    if (endDate) query.set("endDate", new Date(endDate).toISOString());
    return `?${query.toString()}`;
  }, [action, startDate, endDate, page, limit]);

  const auditQuery = useQuery({
    queryKey: ["admin-audit-logs", queryString],
    queryFn: () => adminApi.getAuditLogs(queryString),
  });

  const logs = auditQuery.data?.data || [];
  const pagination = auditQuery.data?.pagination;

  return (
    <div className="space-y-6">
      {auditQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load audit logs</AlertTitle>
          <AlertDescription>{auditQuery.error?.message || "Please retry with a different filter."}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Audit Logs</CardTitle>
          <CardDescription>Read-only activity history with action/date filters and before/after snapshots.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Input placeholder="Action (e.g. ADMIN_EVENT_CANCELLED)" value={action} onChange={(event) => { setPage(1); setAction(event.target.value); }} />
            <Input type="date" value={startDate} onChange={(event) => { setPage(1); setStartDate(event.target.value); }} />
            <Input type="date" value={endDate} onChange={(event) => { setPage(1); setEndDate(event.target.value); }} />
            <Button variant="outline" onClick={() => { setAction(""); setStartDate(""); setEndDate(""); setPage(1); }}>Reset</Button>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <p>Total records: {pagination?.total ?? 0}</p>
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <select className="h-8 rounded-md border border-slate-200 px-2 text-xs" value={limit} onChange={(event) => { setPage(1); setLimit(Number(event.target.value)); }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            {auditQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-28" />
                <SkeletonBlock className="h-28" />
                <SkeletonBlock className="h-28" />
              </div>
            ) : null}
            {logs.map((log) => (
              <div key={log.id} className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-800">{log.action}</p>
                    <p className="text-xs text-slate-500">{log.targetType} • {log.targetId || "-"}</p>
                    <p className="text-xs text-slate-500">By: {log.admin?.fullName || log.admin?.email || "System"}</p>
                  </div>
                  <p className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</p>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="rounded-md bg-slate-50 p-2">
                    <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Before</p>
                    <pre className="max-h-32 overflow-auto text-[11px] text-slate-700">{JSON.stringify(log.beforeState || {}, null, 2)}</pre>
                  </div>
                  <div className="rounded-md bg-slate-50 p-2">
                    <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">After</p>
                    <pre className="max-h-32 overflow-auto text-[11px] text-slate-700">{JSON.stringify(log.afterState || {}, null, 2)}</pre>
                  </div>
                </div>
              </div>
            ))}
            {!auditQuery.isLoading && logs.length === 0 ? <p className="text-sm text-slate-500">No logs for current filters.</p> : null}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
            <p className="text-slate-500">Page {pagination?.page || page} of {pagination?.totalPages || 1}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={(pagination?.page || page) <= 1} onClick={() => setPage(1)}>First</Button>
              <Button variant="outline" size="sm" disabled={(pagination?.page || page) <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1)} onClick={() => setPage((prev) => prev + 1)}>Next</Button>
              <Button variant="outline" size="sm" disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1)} onClick={() => setPage(pagination?.totalPages || 1)}>Last</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
