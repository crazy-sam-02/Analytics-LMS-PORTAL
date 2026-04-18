import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import usePermission from "@/hooks/usePermission";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { ReportsSkeleton } from "@/components/common/page-skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MODE_OPTIONS = [
  { key: "department", label: "Department" },
  { key: "batch", label: "Batch" },
  { key: "student", label: "Student" },
];

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const SORTABLE_KEYS = {
  student: ["testName", "score", "percentile", "timeTaken", "date", "status"],
  department: ["rank", "name", "rollNo", "avgScore", "participation", "violations"],
  batch: ["rank", "name", "rollNo", "avgScore", "participation", "violations"],
};

const DEFAULT_SORT_BY_MODE = {
  student: { key: "date", direction: "desc" },
  department: { key: "avgScore", direction: "desc" },
  batch: { key: "avgScore", direction: "desc" },
};

const toScoreTone = (value) => {
  if (value >= 75) return "text-emerald-700";
  if (value >= 50) return "text-amber-700";
  return "text-red-700";
};

const percentileTone = (value) => {
  if (value >= 90) return "text-emerald-700";
  if (value >= 70) return "text-blue-700";
  if (value >= 50) return "text-amber-700";
  return "text-red-700";
};

const formatPercentile = (value) => {
  if (value == null) return "N/A";
  return `${Number(value).toFixed(0)}th`;
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />
            <span>{item.name}</span>
          </div>
          <span className="font-medium">{typeof item.value === "number" ? item.value.toFixed(2) : item.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description, actionLabel, onAction }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-semibold text-slate-800">{title}</p>
        <p className="max-w-xl text-sm text-slate-500">{description}</p>
        {actionLabel ? (
          <Button type="button" variant="outline" onClick={onAction} className="mt-2">
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DataTable({ mode, rows, attemptRows, sortState, onSortChange }) {
  const parentRef = useRef(null);
  const sourceRows = mode === "student" ? attemptRows : rows;
  const tableRows = useMemo(() => {
    const sorted = [...sourceRows];
    sorted.sort((a, b) => {
      const av = a?.[sortState.key];
      const bv = b?.[sortState.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (sortState.key === "date") {
        return new Date(av).getTime() - new Date(bv).getTime();
      }

      if (sortState.key === "timeTaken") {
        return Number(av || 0) - Number(bv || 0);
      }

      if (sortState.key === "percentile") {
        return Number(av || 0) - Number(bv || 0);
      }

      if (typeof av === "number" && typeof bv === "number") {
        return av - bv;
      }

      return String(av).localeCompare(String(bv));
    });
    return sortState.direction === "desc" ? sorted.reverse() : sorted;
  }, [sourceRows, sortState]);

  const virtualized = tableRows.length > 100;

  const rowVirtualizer = useVirtualizer({
    count: virtualized ? tableRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
  });

  const toggleSort = (key) => {
    onSortChange((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "desc" };
    });
  };

  const sortArrow = (key) => {
    if (sortState.key !== key) return "↕";
    return sortState.direction === "asc" ? "↑" : "↓";
  };

  const sortAria = (key) => {
    if (sortState.key !== key) return "none";
    return sortState.direction === "asc" ? "ascending" : "descending";
  };

  const sortButtonClass = "inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900 transition-colors";

  const renderRow = (row, idx) => {
    if (mode === "student") {
      return (
        <tr key={`${row.testName}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50/70">
          <td className="px-3 py-2">{row.testName}</td>
          <td className={`px-3 py-2 font-medium ${toScoreTone(row.score)}`}>{row.score}</td>
          <td className={`px-3 py-2 ${percentileTone(Number(row.percentile || 0))}`} title={row.percentile == null ? "Percentile is not meaningful with fewer than 5 submissions." : ""}>{formatPercentile(row.percentile)}</td>
          <td className="px-3 py-2">{Math.floor((row.timeTaken || 0) / 60)}m</td>
          <td className="px-3 py-2">{new Date(row.date).toLocaleString()}</td>
          <td className="px-3 py-2">
            <Badge variant={row.status === "SUBMITTED" ? "default" : row.status === "AUTO_SUBMITTED" ? "secondary" : "destructive"}>
              {row.status === "AUTO_SUBMITTED" ? "Auto-submitted" : row.status}
            </Badge>
          </td>
        </tr>
      );
    }

    return (
      <tr key={row.studentId} className="border-b border-slate-100 hover:bg-slate-50/70">
        <td className="px-3 py-2">{row.rank || idx + 1}</td>
        <td className="px-3 py-2">{row.name}</td>
        <td className="px-3 py-2">{row.rollNo}</td>
        <td className={`px-3 py-2 font-medium ${toScoreTone(row.avgScore)}`}>{Number(row.avgScore).toFixed(2)}</td>
        <td className="px-3 py-2">{Number(row.participation || 0).toFixed(1)}%</td>
        <td className="px-3 py-2">
          {row.violations === 0 ? <Badge variant="outline">Clean</Badge> : <Badge variant={row.violations > 2 ? "destructive" : "secondary"}>{row.violations}</Badge>}
        </td>
      </tr>
    );
  };

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader>
        <CardTitle>{mode === "student" ? "Attempt History" : "Top Students"}</CardTitle>
      </CardHeader>
      <CardContent>
        {tableRows.length === 0 ? (
          <p className="text-sm text-slate-500">No rows to display.</p>
        ) : (
          <div ref={parentRef} className={virtualized ? "max-h-96 overflow-y-auto" : ""}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase">
                  {mode === "student" ? (
                    <>
                      <th className="px-3 py-2" aria-sort={sortAria("testName")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("testName")}>Test Name {sortArrow("testName")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("score")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("score")}>Score {sortArrow("score")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("percentile")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("percentile")}>Percentile {sortArrow("percentile")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("timeTaken")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("timeTaken")}>Time {sortArrow("timeTaken")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("date")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("date")}>Date {sortArrow("date")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("status")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("status")}>Status {sortArrow("status")}</button></th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2" aria-sort={sortAria("rank")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("rank")}>Rank {sortArrow("rank")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("name")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("name")}>Name {sortArrow("name")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("rollNo")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("rollNo")}>Roll No {sortArrow("rollNo")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("avgScore")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("avgScore")}>Avg Score {sortArrow("avgScore")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("participation")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("participation")}>Participation {sortArrow("participation")}</button></th>
                      <th className="px-3 py-2" aria-sort={sortAria("violations")}><button className={sortButtonClass} type="button" onClick={() => toggleSort("violations")}>Violations {sortArrow("violations")}</button></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {virtualized
                  ? rowVirtualizer.getVirtualItems().map((virtualRow) => renderRow(tableRows[virtualRow.index], virtualRow.index))
                  : tableRows.map((row, idx) => renderRow(row, idx))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const canViewReports = usePermission(ADMIN_PERMISSIONS.VIEW_REPORTS);
  const canExportReports = usePermission(ADMIN_PERMISSIONS.EXPORT_REPORTS);
  const admin = useSelector((state) => state.adminAuth.admin);
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState(searchParams.get("mode") || "department");
  const [testId, setTestId] = useState(searchParams.get("test") || "all");
  const [departmentId, setDepartmentId] = useState(searchParams.get("department_id") || "");
  const [batchId, setBatchId] = useState(searchParams.get("batch_id") || "");
  const [studentId, setStudentId] = useState(searchParams.get("student_id") || "");
  const [sortState, setSortState] = useState(() => {
    const key = searchParams.get("sort_key");
    const direction = searchParams.get("sort_dir") === "asc" ? "asc" : "desc";
    if (key && SORTABLE_KEYS[mode]?.includes(key)) {
      return { key, direction };
    }
    return DEFAULT_SORT_BY_MODE[mode] || DEFAULT_SORT_BY_MODE.department;
  });
  const [studentSearch, setStudentSearch] = useState("");
  const [studentDropdownOpen, setStudentDropdownOpen] = useState(false);
  const [exportState, setExportState] = useState({ status: "idle", jobId: null, progress: 0, downloadUrl: null, expiresAt: null });
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const exportPollRef = useRef(null);
  const deferredStudentSearch = useDeferredValue(studentSearch.trim());

  const testsQuery = useQuery({ queryKey: ["admin-report-tests"], queryFn: () => adminApi.getTests("?page=1&limit=200"), staleTime: 120000 });
  const departmentsQuery = useQuery({ queryKey: ["admin-report-departments"], queryFn: () => adminApi.getDepartments(), staleTime: 120000 });
  const batchesQuery = useQuery({ queryKey: ["admin-report-batches"], queryFn: () => adminApi.getBatches(), staleTime: 120000 });
  const studentsQuery = useQuery({
    queryKey: ["admin-report-students", deferredStudentSearch],
    queryFn: () => {
      const query = new URLSearchParams();
      query.set("page", "1");
      query.set("limit", deferredStudentSearch.length >= 2 ? "30" : "100");
      if (deferredStudentSearch.length >= 2) {
        query.set("search", deferredStudentSearch);
      }
      return adminApi.getStudents(`?${query.toString()}`);
    },
    staleTime: 60000,
  });
  const selectedStudentQuery = useQuery({
    queryKey: ["admin-report-student-profile", studentId],
    queryFn: () => adminApi.getStudentProfile(studentId),
    enabled: mode === "student" && Boolean(studentId),
    staleTime: 60000,
  });

  const analyticsQuery = useQuery({
    queryKey: ["report", mode, departmentId, batchId, studentId, testId],
    queryFn: () => {
      const query = new URLSearchParams();
      query.set("mode", mode);
      if (departmentId) query.set("departmentId", departmentId);
      if (batchId) query.set("batchId", batchId);
      if (studentId) query.set("studentId", studentId);
      if (testId !== "all") query.set("testId", testId);
      return adminApi.getReportAnalytics(`?${query.toString()}`);
    },
    staleTime: mode === "student" ? 0 : 120000,
    enabled: canViewReports,
  });

  useEffect(() => {
    const sortValid = SORTABLE_KEYS[mode]?.includes(sortState.key);
    if (!sortValid) {
      setSortState(DEFAULT_SORT_BY_MODE[mode] || DEFAULT_SORT_BY_MODE.department);
    }
  }, [mode, sortState.key]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("mode", mode);
    next.set("test", testId);
    next.set("sort_key", sortState.key);
    next.set("sort_dir", sortState.direction);
    if (departmentId) next.set("department_id", departmentId);
    if (batchId) next.set("batch_id", batchId);
    if (studentId) next.set("student_id", studentId);
    setSearchParams(next, { replace: true });
  }, [mode, testId, departmentId, batchId, studentId, sortState.key, sortState.direction, setSearchParams]);

  useEffect(() => {
    return () => {
      if (exportPollRef.current) {
        clearInterval(exportPollRef.current);
      }
    };
  }, []);

  const tests = testsQuery.data?.data || [];
  const departments = useMemo(() => departmentsQuery.data || [], [departmentsQuery.data]);
  const batches = useMemo(
    () => (batchesQuery.data || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [batchesQuery.data]
  );
  const students = useMemo(() => studentsQuery.data?.data || [], [studentsQuery.data]);

  useEffect(() => {
    if (mode === "department" && !departmentId && departments.length > 0) {
      setDepartmentId(departments[0].id);
    }
    if (mode === "batch" && !batchId && batches.length > 0) {
      setBatchId(batches[0].id);
    }
    if (mode === "student" && !studentId && students.length > 0) {
      setStudentId(students[0].id);
    }
  }, [mode, departmentId, batchId, studentId, departments, batches, students]);

  const filteredStudentResults = useMemo(() => {
    if (deferredStudentSearch.length < 2) return [];
    return students.slice(0, 10);
  }, [deferredStudentSearch, students]);
  const selectedStudent = selectedStudentQuery.data || students.find((item) => item.id === studentId);

  const modeTypeForExport = mode === "department" ? "DEPARTMENT_WISE" : mode === "batch" ? "BATCH_WISE" : "STUDENT_WISE";

  const downloadCsv = (rows, fileName) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      toast.error("No data available for export.");
      return;
    }

    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")].concat(rows.map((row) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startExport = async () => {
    if (!canExportReports) return;
    setExportState({ status: "loading", jobId: null, progress: 0, downloadUrl: null, expiresAt: null });
    try {
      const filters = {};
      if (testId !== "all") filters.testId = testId;
      if (mode === "department" && departmentId) filters.departmentId = departmentId;
      if (mode === "batch" && batchId) filters.batchId = batchId;
      if (mode === "student" && studentId) filters.studentId = studentId;

      const created = await adminApi.exportReport({ type: modeTypeForExport, filters });
      const jobId = created.jobId;
      setBanner({ type: "success", title: "Export queued", message: "Report generation job has started." });
      setExportState({ status: "polling", jobId, progress: 0, downloadUrl: null, expiresAt: null });

      if (exportPollRef.current) {
        clearInterval(exportPollRef.current);
      }

      exportPollRef.current = setInterval(async () => {
        try {
          const status = await adminApi.getAdminJobStatus(jobId);
          if (status.status === "processing" || status.status === "queued") {
            setExportState((prev) => ({ ...prev, status: "polling", progress: Number(status.progress || 0) }));
            return;
          }

          if (status.status === "complete" || status.status === "completed") {
            clearInterval(exportPollRef.current);
            exportPollRef.current = null;
            setBanner({ type: "success", title: "Export ready", message: "Download link is ready. Use the Download button." });
            setExportState({ status: "complete", jobId, progress: 100, downloadUrl: status.download_url, expiresAt: status.expires_at });
            return;
          }

          clearInterval(exportPollRef.current);
          exportPollRef.current = null;
          setExportState({ status: "failed", jobId, progress: 0, downloadUrl: null, expiresAt: null });
          setBanner({ type: "error", title: "Export failed", message: "Job finished with an error. Retry export." });
          toast.error("Export failed. Try again.");
        } catch {
          clearInterval(exportPollRef.current);
          exportPollRef.current = null;
          setExportState({ status: "failed", jobId, progress: 0, downloadUrl: null, expiresAt: null });
          setBanner({ type: "error", title: "Polling failed", message: "Could not track export job status." });
          toast.error("Export status polling failed.");
        }
      }, 3000);
    } catch (error) {
      setExportState({ status: "failed", jobId: null, progress: 0, downloadUrl: null, expiresAt: null });
      setBanner({ type: "error", title: "Export not started", message: error?.message || "Unable to start export job." });
      toast.error(error?.message || "Unable to start export job.");
    }
  };

  const onDownload = async () => {
    if (!exportState.jobId) return;
    if (exportState.expiresAt && new Date(exportState.expiresAt).getTime() <= Date.now() + 60_000) {
      setExportState((prev) => ({ ...prev, status: "loading" }));
      const refreshed = await adminApi.regenerateReportLink(exportState.jobId);
      setExportState((prev) => ({ ...prev, status: "complete", downloadUrl: refreshed.resultUrl, expiresAt: refreshed.expiresAt }));
    }
    window.open(`/api${exportState.downloadUrl || `/admin/reports/${exportState.jobId}/download`}`, "_blank", "noopener,noreferrer");
  };

  if (!canViewReports) {
    return <PermissionDenied action="view reports" />;
  }

  const data = analyticsQuery.data;
  const loading = analyticsQuery.isFetching;
  const noData = !loading && (!data || (mode === "student" ? (data.attemptHistory || []).length === 0 : (data.tableRows || []).length === 0));

  if (loading && !data) {
    return <ReportsSkeleton />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 sm:px-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{admin?.college?.name || "College"}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Reports & Analytics</h1>
          <p className="text-sm text-slate-500">Analyse performance by department, batch, or student.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={testId} onValueChange={setTestId}>
            <SelectTrigger className="min-w-56"><SelectValue placeholder="All Tests" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tests</SelectItem>
              {tests.map((test) => (
                <SelectItem key={test.id} value={test.id}>{test.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={exportState.status === "complete" ? onDownload : startExport}
            disabled={!canExportReports || exportState.status === "loading" || exportState.status === "polling"}
            title={!canExportReports ? "You don't have permission to export reports. Contact your platform administrator." : ""}
          >
            {exportState.status === "loading" ? "Generating..." : exportState.status === "polling" ? `Processing ${exportState.progress}%` : exportState.status === "complete" ? "Download" : "Export"}
          </Button>

          <Button
            type="button"
            variant="link"
            className="h-auto px-0 text-xs"
            onClick={() => downloadCsv(mode === "batch" ? (analyticsQuery.data?.batchComparative || []) : (analyticsQuery.data?.departmentComparative || []), `${mode}-comparison.csv`)}
          >
            Export comparison CSV
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 text-xs"
            onClick={() => downloadCsv(analyticsQuery.data?.scoreTrend || [], `${mode}-trend.csv`)}
          >
            Export trend CSV
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {MODE_OPTIONS.map((item) => (
            <Button
              key={item.key}
              size="sm"
              type="button"
              variant={mode === item.key ? "default" : "outline"}
              onClick={() => {
                setMode(item.key);
                if (item.key === "department") setDepartmentId("");
                if (item.key === "batch") setBatchId("");
                if (item.key === "student") setStudentId("");
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {mode === "department" ? (
          <div className="flex flex-wrap gap-2">
            {departments.map((item) => (
              <Button key={item.id} size="sm" variant={departmentId === item.id ? "default" : "outline"} onClick={() => setDepartmentId(item.id)}>
                {item.name}
              </Button>
            ))}
          </div>
        ) : null}

        {mode === "batch" ? (
          <Select value={batchId || undefined} onValueChange={setBatchId}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Select batch" /></SelectTrigger>
            <SelectContent>
              {batches.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {mode === "student" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" />
              <Input
                value={studentSearch}
                onChange={(event) => {
                  setStudentSearch(event.target.value);
                  setStudentDropdownOpen(true);
                }}
                className="pl-9"
                placeholder="Search student by name or roll number"
              />
              {studentDropdownOpen && studentSearch.trim().length >= 2 ? (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {filteredStudentResults.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-slate-500">No results for "{studentSearch}"</p>
                  ) : filteredStudentResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setStudentId(item.id);
                        setStudentSearch(`${item.fullName} (${item.studentId})`);
                        setStudentDropdownOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span>{item.fullName}</span>
                      <span className="text-xs text-slate-500">{item.studentId}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Select value={studentId || undefined} onValueChange={(value) => {
              setStudentId(value);
              const matched = students.find((item) => item.id === value);
              if (matched) setStudentSearch(`${matched.fullName} (${matched.studentId})`);
            }}>
              <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
              <SelectContent>
                {students.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.fullName} ({item.studentId})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{testId === "all" ? "All Tests" : tests.find((test) => test.id === testId)?.title || "Selected Test"}</Badge>
          <Badge variant="outline">{new Date().getFullYear()}-{new Date().getFullYear() + 1}</Badge>
        </div>
      </section>

      {noData ? (
        <EmptyState
          title={mode === "student" ? "No tests attempted yet" : "No data available"}
          description={mode === "student" ? "This student has not submitted any tests in the selected filter scope." : "No data for this filter combination. Try All Tests to see full report."}
          actionLabel={testId !== "all" ? "Reset to All Tests" : undefined}
          onAction={testId !== "all" ? () => setTestId("all") : undefined}
        />
      ) : (
        <section className="space-y-4">
          {mode === "student" ? (
            <Card className="rounded-2xl border-slate-200">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-lg font-semibold text-slate-900">{data?.selectedStudent?.name || selectedStudent?.fullName || "Student"}</p>
                  <p className="text-sm text-slate-500">{selectedStudent?.studentId || "-"} • {selectedStudent?.department?.name || "-"} • {selectedStudent?.batch?.name || "-"}</p>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div><p className="text-slate-500">Avg Score</p><p className="font-semibold">{Number(data?.metrics?.avgScore || 0).toFixed(2)}</p></div>
                  <div><p className="text-slate-500">Percentile</p><p className={percentileTone(Number(data?.attemptHistory?.[0]?.percentile || 0))}>{formatPercentile(data?.attemptHistory?.[0]?.percentile)}</p></div>
                  <div><p className="text-slate-500">College Rank</p><p className="font-semibold">#{data?.selectedStudent?.rank || "-"}</p></div>
                  <div><p className="text-slate-500">Violations</p><p className={Number(data?.metrics?.violations || 0) > 2 ? "text-red-700" : Number(data?.metrics?.violations || 0) > 0 ? "text-amber-700" : "text-emerald-700"}>{data?.metrics?.violations || 0}</p></div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-4">
              <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Average Score</p><p className={`text-2xl font-semibold ${toScoreTone(Number(data?.metrics?.avgScore || 0))}`}>{Number(data?.metrics?.avgScore || 0).toFixed(2)}</p></CardContent></Card>
              <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Pass Rate</p><p className="text-2xl font-semibold">{Number(data?.metrics?.passRate || 0).toFixed(1)}%</p></CardContent></Card>
              <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Participation</p><p className="text-2xl font-semibold">{Number(data?.metrics?.participationRate || 0).toFixed(1)}%</p></CardContent></Card>
              <Card className="rounded-2xl border-slate-200"><CardContent className="p-4"><p className="text-xs text-slate-500">Violations</p><p className={`text-2xl font-semibold ${Number(data?.metrics?.violations || 0) > 10 ? "text-red-700" : ""}`}>{data?.metrics?.violations || 0}</p></CardContent></Card>
            </div>
          )}

          {(data?.anomalyAlerts || []).length > 0 ? (
            <Card className="rounded-2xl border-red-200 bg-red-50/40">
              <CardHeader>
                <CardTitle className="text-red-900">Anomaly Alerts</CardTitle>
                <CardDescription>Potentially suspicious attempts based on score/violation/time patterns.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-2">
                {(data?.anomalyAlerts || []).map((alert) => (
                  <div key={alert.id} className="rounded-lg border border-red-200 bg-white px-3 py-2">
                    <p className="text-sm font-semibold text-red-900">{alert.label}</p>
                    <p className="text-xs text-slate-600">{alert.message}</p>
                    <p className="mt-1 text-xs text-slate-500">Student: {alert.studentName || "-"} • Test: {alert.testName || "-"}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="rounded-2xl border-slate-200 lg:col-span-3">
              <CardHeader><CardTitle>{mode === "batch" ? "Score Trend" : mode === "student" ? "Score Progression" : "Score Trend"}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  {mode === "batch" ? (
                    <LineChart data={data?.scoreTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                      <Line type="monotone" dataKey="score" name="Score" stroke="var(--chart-1)" dot={{ r: 5 }} isAnimationActive={false} connectNulls />
                    </LineChart>
                  ) : (
                    <AreaChart data={data?.scoreTrend || []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                      {mode === "student" ? <ReferenceLine y={Number(data?.metrics?.avgScore || 0)} stroke="var(--muted-foreground)" strokeDasharray="4 4" /> : null}
                      <Area type="monotone" dataKey="score" name="Score" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.2} isAnimationActive={false} connectNulls dot={{ r: (data?.scoreTrend || []).length === 1 ? 5 : 0 }} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
                {(data?.scoreTrend || []).some((row) => row.score == null) ? <p className="mt-2 text-xs text-slate-500">Gaps indicate months with no scheduled tests.</p> : null}
                {mode === "student" && (data?.scoreTrend || []).length === 1 ? <p className="mt-2 text-xs text-slate-500">Only 1 test taken - trend requires 2+ data points.</p> : null}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 lg:col-span-2">
              <CardHeader><CardTitle>{mode === "batch" ? "Score Distribution" : "Topic Performance"}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  {mode === "batch" ? (
                    <PieChart>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                      <Pie
                        data={data?.distribution || []}
                        dataKey="count"
                        nameKey="range"
                        innerRadius={55}
                        outerRadius={85}
                        isAnimationActive={false}
                        label
                      >
                        {(data?.distribution || []).map((entry, index) => <Cell key={entry.range} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  ) : ((data?.topicPerformance || []).length >= 3 ? (
                    <RadarChart data={data?.topicPerformance || []}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="topic" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                      <Radar name="Score" dataKey="score" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.35} isAnimationActive={false} />
                    </RadarChart>
                  ) : (
                    <BarChart data={data?.topicPerformance || []} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} />
                      <YAxis dataKey="topic" type="category" axisLine={false} tickLine={false} width={80} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="score" name="Score" isAnimationActive={false}>
                        {(data?.topicPerformance || []).map((entry) => (
                          <Cell key={entry.topic} fill={entry.score >= 75 ? "var(--chart-2)" : entry.score >= 50 ? "var(--chart-4)" : "var(--chart-5)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  ))}
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl border-slate-200">
            <CardHeader><CardTitle>{mode === "batch" ? "Batch Comparative" : "Department Comparative"}</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={mode === "batch" ? (data?.batchComparative || []) : (data?.departmentComparative || [])}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey={mode === "batch" ? "batchName" : "departmentName"} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Bar dataKey="avgScore" name="Avg Score" fill="var(--chart-1)" isAnimationActive={false} />
                  <Bar dataKey="passRate" name="Pass Rate" fill="var(--chart-2)" isAnimationActive={false} />
                  {mode === "department" ? <Bar dataKey="participationRate" name="Participation" fill="var(--chart-3)" isAnimationActive={false} /> : null}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <DataTable mode={mode} rows={data?.tableRows || []} attemptRows={data?.attemptHistory || []} sortState={sortState} onSortChange={setSortState} />
        </section>
      )}
    </div>
  );
}
