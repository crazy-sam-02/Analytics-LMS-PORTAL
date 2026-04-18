import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperReports, generateSuperReport } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi, superAdminTokenStorage } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const reportTypes = ["STUDENT_WISE", "TEST_WISE", "DEPARTMENT_WISE", "BATCH_WISE"];
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/api\/?$/, "");

export default function ReportsPage() {
  const dispatch = useDispatch();
  const reports = useSelector((state) => state.superAdminPanel.reports);
  const [downloading, setDownloading] = useState(null);
  const [regenerating, setRegenerating] = useState(null);
  const [liveEscalations, setLiveEscalations] = useState([]);
  const [savedEscalations, setSavedEscalations] = useState([]);

  useEffect(() => {
    dispatch(fetchSuperReports());
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;

    const loadEscalations = async () => {
      try {
        const response = await superAdminApi.getEscalatedAnomalies("?limit=100");
        if (!cancelled) {
          setSavedEscalations(Array.isArray(response?.data) ? response.data : []);
        }
      } catch (_error) {
        if (!cancelled) {
          toast.error("Unable to load escalation history.");
        }
      }
    };

    loadEscalations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const accessToken = superAdminTokenStorage.getAccess();
    if (!accessToken) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      transports: ["websocket"],
      withCredentials: true,
      auth: {
        token: `Bearer ${accessToken}`,
      },
    });

    const onEscalation = (payload) => {
      setLiveEscalations((prev) => [payload, ...prev].slice(0, 25));
      toast(`Anomaly escalated from college ${payload?.collegeId || "-"}`);
    };

    socket.on("report:anomaly_escalated", onEscalation);

    return () => {
      socket.off("report:anomaly_escalated", onEscalation);
      socket.disconnect();
    };
  }, []);

  const escalationFeed = [
    ...liveEscalations.map((item, index) => ({
      key: `live-${item?.anomalyId || "anomaly"}-${index}`,
      anomalyType: item?.anomalyType,
      testId: item?.testId,
      testTitle: null,
      collegeName: null,
      collegeCode: item?.collegeId,
      adminName: item?.adminName || item?.adminId,
      reason: item?.reason,
      escalatedAt: item?.escalatedAt || new Date().toISOString(),
      source: "Live",
    })),
    ...savedEscalations.map((item) => ({
      key: `saved-${item.id}`,
      anomalyType: item?.anomalyType,
      testId: item?.test?.id || item?.testId,
      testTitle: item?.test?.title || null,
      collegeName: item?.college?.name || null,
      collegeCode: item?.college?.code || item?.college?.id || null,
      adminName: item?.admin?.fullName || item?.admin?.email || "-",
      reason: item?.reason,
      escalatedAt: item?.escalatedAt,
      source: "Saved",
    })),
  ]
    .sort((a, b) => new Date(b.escalatedAt).getTime() - new Date(a.escalatedAt).getTime())
    .slice(0, 100);

  const request = async (type) => {
    await dispatch(generateSuperReport({ type, filters: {} }));
    dispatch(fetchSuperReports());
  };

  const download = async (reportJobId) => {
    setDownloading(reportJobId);
    try {
      const result = await superAdminApi.downloadReport(reportJobId);
      const blob = new Blob([JSON.stringify(result.rows, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `super-report-${reportJobId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Report download started.");
    } catch (error) {
      if (error?.code === "REPORT_URL_EXPIRED") {
        toast.error("Download link expired. Regenerate the link.");
      } else {
        toast.error(error?.message || "Unable to download report.");
      }
    } finally {
      setDownloading(null);
    }
  };

  const regenerateLink = async (reportJobId) => {
    setRegenerating(reportJobId);
    try {
      await superAdminApi.regenerateReportLink(reportJobId);
      toast.success("Download link regenerated.");
      dispatch(fetchSuperReports());
    } catch (error) {
      toast.error(error?.message || "Unable to regenerate link.");
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Generate Global Reports</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {reportTypes.map((type) => (
            <Button key={type} variant="outline" onClick={() => request(type)}>{type}</Button>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Live Escalations</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {escalationFeed.length === 0 ? <p className="text-sm text-slate-500">No escalations yet.</p> : null}
          {escalationFeed.map((item) => (
            <div key={item.key} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-900">{item.anomalyType || "ANOMALY"} • Test {item.testTitle || item.testId || "-"}</p>
              <p className="text-xs text-slate-500">
                College: {item.collegeName || item.collegeCode || "-"} • By: {item.adminName || "-"} • {item.source}
              </p>
              <p className="mt-1 text-xs text-slate-600">Reason: {item.reason || "No reason provided"}</p>
              <p className="mt-1 text-[11px] text-slate-400">{new Date(item.escalatedAt).toLocaleString()}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Report Jobs</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {reports.map((job) => (
            <div key={job.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <div>
                <p className="font-medium text-slate-800">{job.type}</p>
                <p className="text-xs text-slate-500">{job.status} • {new Date(job.createdAt).toLocaleString()}</p>
                {job.downloadExpiresAt ? (
                  <p className="text-[11px] text-slate-400">Link expires: {new Date(job.downloadExpiresAt).toLocaleString()}</p>
                ) : null}
              </div>
              {job.status === "COMPLETED" ? (
                job.downloadExpiresAt && new Date(job.downloadExpiresAt).getTime() <= Date.now() ? (
                  <Button size="sm" variant="outline" onClick={() => regenerateLink(job.id)} disabled={regenerating === job.id}>
                    {regenerating === job.id ? "Regenerating..." : "Regenerate Link"}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => download(job.id)} disabled={downloading === job.id}>
                    {downloading === job.id ? "Downloading..." : "Download"}
                  </Button>
                )
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
