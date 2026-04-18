import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperAuditLogs } from "@/features/SuperAdmin/superAdminPanelSlice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuditLogsPage() {
  const dispatch = useDispatch();
  const auditLogs = useSelector((state) => state.superAdminPanel.auditLogs);

  useEffect(() => {
    dispatch(fetchSuperAuditLogs());
  }, [dispatch]);

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {auditLogs.map((log) => (
          <div key={log.id} className="rounded-xl border border-slate-200 px-3 py-2">
            <p className="font-medium text-slate-800">{log.action}</p>
            <p className="text-xs text-slate-500">Target: {log.targetType} • User: {log.superAdmin?.email || log.admin?.email || "-"}</p>
            <p className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
