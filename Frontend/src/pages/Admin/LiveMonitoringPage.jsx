import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { connectTestSocket, disconnectTestSocket, joinTestRoom, leaveTestRoom } from "@/services/testSocket";
import ViolationFeed from "@/components/Admin/ViolationFeed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const statusTone = {
  ONLINE: "text-emerald-700",
  UNSTABLE: "text-amber-700",
  OFFLINE: "text-slate-500",
};

export default function LiveMonitoringPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const parentRef = useRef(null);
  const [socketHealthy, setSocketHealthy] = useState(true);
  const [studentRows, setStudentRows] = useState([]);
  const [violationFeed, setViolationFeed] = useState([]);
  const [forceDialog, setForceDialog] = useState({ open: false, row: null, reason: "" });
  const [extendDialog, setExtendDialog] = useState({ open: false, row: null, minutes: 10 });

  const monitorQuery = useQuery({
    queryKey: ["admin-live-monitoring", testId],
    queryFn: () => adminApi.getTestMonitoring(testId),
    enabled: Boolean(testId),
    refetchInterval: socketHealthy ? false : 10000,
    staleTime: socketHealthy ? 5000 : 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: !socketHealthy,
  });

  useEffect(() => {
    if (!monitorQuery.data) return;
    setStudentRows(monitorQuery.data.studentTable || []);
    setViolationFeed(monitorQuery.data.violationFeed || []);
  }, [monitorQuery.data]);

  useEffect(() => {
    if (!testId) return undefined;

    const socket = connectTestSocket("admin");

    const onConnect = () => {
      setSocketHealthy(true);
      joinTestRoom(testId);
    };
    const onDisconnect = () => {
      setSocketHealthy(false);
      toast.warning("Socket disconnected. Fallback polling activated.");
    };
    const onConnectError = () => {
      setSocketHealthy(false);
    };
    const onStatusUpdate = (payload) => {
      if (!payload || payload.testId !== testId) return;
      setStudentRows((prev) => {
        const index = prev.findIndex((item) => item.submissionId === payload.submissionId);
        if (index < 0) return prev;
        const next = [...prev];
        next[index] = { ...next[index], ...payload };
        return next;
      });
    };
    const onViolationEvent = (payload) => {
      if (!payload || payload.testId !== testId) return;
      setViolationFeed((prev) => [{ ...payload, id: `${payload.submissionId}-${payload.at || Date.now()}` }, ...prev].slice(0, 100));
    };
    const onTestStatusChange = (payload) => {
      if (!payload || payload.testId !== testId) return;
      if (payload.action === "FORCE_SUBMIT" || payload.action === "ATTEMPT_SUBMITTED") {
        setStudentRows((prev) => prev.filter((item) => item.submissionId !== payload.submissionId));
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("student_status_update", onStatusUpdate);
    socket.on("violation_event", onViolationEvent);
    socket.on("test_status_change", onTestStatusChange);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      leaveTestRoom(testId);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("student_status_update", onStatusUpdate);
      socket.off("violation_event", onViolationEvent);
      socket.off("test_status_change", onTestStatusChange);
      disconnectTestSocket();
    };
  }, [testId]);

  const virtualized = studentRows.length > 50;
  const rowVirtualizer = useVirtualizer({
    count: virtualized ? studentRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
  });

  const activeStudents = useMemo(() => studentRows.length, [studentRows]);

  const forceSubmit = async () => {
    if (!forceDialog.row?.submissionId || !forceDialog.reason.trim()) return;
    await adminApi.forceSubmitAttempt(testId, {
      submissionId: forceDialog.row.submissionId,
      reason: forceDialog.reason.trim(),
    });
    toast.success("Student attempt force-submitted.");
    setForceDialog({ open: false, row: null, reason: "" });
    monitorQuery.refetch();
  };

  const extendTime = async () => {
    if (!extendDialog.row?.submissionId) return;
    await adminApi.extendAttemptTime(testId, {
      submissionId: extendDialog.row.submissionId,
      minutes: Number(extendDialog.minutes || 0),
    });
    toast.success("Extra time granted.");
    setExtendDialog({ open: false, row: null, minutes: 10 });
    monitorQuery.refetch();
  };

  const renderRow = (row) => (
    <tr key={row.submissionId} className="border-b border-slate-100">
      <td className="px-3 py-2">{row.name}</td>
      <td className="px-3 py-2">{row.department}</td>
      <td className="px-3 py-2">{row.progress}%</td>
      <td className="px-3 py-2">{Math.max(0, Math.floor(Number(row.timeLeftSec || 0) / 60))}m</td>
      <td className="px-3 py-2">{row.violations}</td>
      <td className={`px-3 py-2 font-medium ${statusTone[row.connectionStatus] || statusTone.OFFLINE}`}>{row.connectionStatus}</td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setExtendDialog({ open: true, row, minutes: 10 })}>Extend Time</Button>
          <Button size="sm" variant="destructive" onClick={() => setForceDialog({ open: true, row, reason: "" })}>Force Submit</Button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Live Test Monitoring</h1>
          <p className="text-sm text-slate-500">Socket-first real-time monitoring for active attempts.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${socketHealthy ? "text-emerald-700" : "text-amber-700"}`}>
            {socketHealthy ? "Socket Connected" : "Fallback Polling"}
          </span>
          <Button variant="outline" onClick={() => navigate("/admin/tests")}>Back to Tests</Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Active Students</p><p className="text-2xl font-semibold">{activeStudents}</p></CardContent></Card>
        <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Test</p><p className="text-base font-semibold">{monitorQuery.data?.test?.title || "-"}</p></CardContent></Card>
        <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Question Count</p><p className="text-2xl font-semibold">{monitorQuery.data?.test?.questionCount || 0}</p></CardContent></Card>
      </div>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Student Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={parentRef} className={virtualized ? "max-h-112 overflow-y-auto" : ""}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Time Left</th>
                  <th className="px-3 py-2">Violations</th>
                  <th className="px-3 py-2">Connection</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {virtualized ? rowVirtualizer.getVirtualItems().map((virtualRow) => renderRow(studentRows[virtualRow.index])) : studentRows.map((row) => renderRow(row))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ViolationFeed items={violationFeed} />

      <AlertDialog open={forceDialog.open} onOpenChange={(open) => setForceDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force Submit Attempt</AlertDialogTitle>
            <AlertDialogDescription>This action is irreversible. Provide a reason.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={forceDialog.reason} onChange={(event) => setForceDialog((prev) => ({ ...prev, reason: event.target.value }))} placeholder="Reason for force submit" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!forceDialog.reason.trim()} onClick={forceSubmit}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={extendDialog.open} onOpenChange={(open) => setExtendDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Extend Time</AlertDialogTitle>
            <AlertDialogDescription>Add extra minutes for this student attempt.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input type="number" min={1} max={120} value={extendDialog.minutes} onChange={(event) => setExtendDialog((prev) => ({ ...prev, minutes: Number(event.target.value) }))} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={extendTime}>Apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
