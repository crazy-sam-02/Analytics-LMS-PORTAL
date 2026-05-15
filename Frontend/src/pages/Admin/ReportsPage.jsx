import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import usePermission from "@/hooks/usePermission";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { adminApi } from "@/services/api";
import {
  AreaTrendChart,
  ChartCard,
  EmptyState,
  ExportButton,
  GroupedBarChart,
  HorizontalBarChart,
  KpiCard,
  LineTrendChart,
  ScoreBadge,
  ScoreDonutChart,
  StatusBadge,
  StudentIdentityCard,
  Th,
  TopicRadarChart,
  ViolationBadge,
} from "@/components/Reports/components";
import { formatDateLabel, formatPercent, toQueryString } from "@/components/Reports/utils";

const ADMIN_MODES = [
  { key: "department", label: "Department" },
  { key: "batch", label: "Batch" },
  { key: "student", label: "Student" },
];

const MODE_DEFAULT_SORT = {
  department: { key: "rank", dir: "asc" },
  batch: { key: "avgScore", dir: "desc" },
  student: { key: "date", dir: "desc" },
};

const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));

const getSortValue = (row, key) => {
  if (!row) return null;
  if (key === "date") return new Date(row.date || 0).getTime();
  return row[key] ?? null;
};

const sortRows = (rows, sortState) => {
  if (!Array.isArray(rows) || !rows.length) return [];
  const { key, dir } = sortState || {};
  if (!key) return [...rows];
  const multiplier = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * multiplier;
    }
    return String(av).localeCompare(String(bv)) * multiplier;
  });
};

const getStatusVariant = (status) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "submitted") return "success";
  if (normalized === "auto_submitted" || normalized === "auto-submitted") return "warning";
  if (normalized === "abandoned") return "danger";
  return "default";
};

const formatViolationType = (type) => String(type || "UNKNOWN").replace(/_/g, " ").toLowerCase();

export default function ReportsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canViewReports = usePermission(ADMIN_PERMISSIONS.VIEW_REPORTS);
  const canExportReports = usePermission(ADMIN_PERMISSIONS.EXPORT_REPORTS);

  const mode = ADMIN_MODES.some((item) => item.key === searchParams.get("mode")) ? searchParams.get("mode") : "department";
  const testId = searchParams.get("test") || "all";
  const batchId = searchParams.get("batch") || "";
  const studentId = searchParams.get("student_id") || "";

  const [studentSearch, setStudentSearch] = useState("");
  const [sortState, setSortState] = useState(MODE_DEFAULT_SORT[mode]);
  const [exportState, setExportState] = useState({
    status: "idle",
    progress: 0,
    downloadUrl: "",
    expiresAt: null,
    jobId: "",
  });
  const [violationDialog, setViolationDialog] = useState({
    open: false,
    studentName: "",
    events: [],
  });

  const pollRef = useRef(null);

  const updateParams = (next) => {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });
    setSearchParams(nextParams);
  };

  const testsQuery = useQuery({
    queryKey: ["admin-report-tests-v2"],
    queryFn: () => adminApi.getTests("?page=1&limit=100"),
    staleTime: 120000,
  });

  const batchesQuery = useQuery({
    queryKey: ["admin-report-batches-v2"],
    queryFn: () => adminApi.getBatches(),
    staleTime: 120000,
  });

  const studentsDirectoryQuery = useQuery({
    queryKey: ["admin-report-students-directory-v2"],
    queryFn: () => adminApi.getStudents("?page=1&limit=300"),
    staleTime: 120000,
  });

  const analyticsQuery = useQuery({
    queryKey: ["admin-report-analytics-v2", mode, testId, batchId, studentId],
    queryFn: () =>
      adminApi.getReportAnalytics(
        toQueryString({
          mode,
          testId,
          batchId,
          studentId,
        })
      ),
    enabled: canViewReports && (mode !== "student" || Boolean(studentId)),
    staleTime: 45000,
  });

  const tests = testsQuery.data?.data || [];
  const batches = batchesQuery.data || [];
  const studentsDirectory = studentsDirectoryQuery.data?.data || [];
  const analytics = analyticsQuery.data || {};

  const trendData = (analytics.scoreTrend || []).map((item, index) => ({
    month: item.month || `Test ${index + 1}`,
    score: Number(item.score || 0),
  }));

  const topicData = (analytics.topicPerformance || []).map((item, index) => ({
    subject: item.subject || item.topic || `Topic ${index + 1}`,
    score: Number(item.score || item.avgScore || 0),
  }));

  const departmentComparative = (analytics.departmentComparative || []).map((item) => ({
    department: item.departmentName || item.department || "-",
    avgScore: Number(item.avgScore || 0),
    passRate: Number(item.passRate || 0),
    participationRate: Number(item.participationRate || 0),
    violations: Number(item.violations || 0),
    students: Number(item.students || 0),
  }));

  const batchComparative = (analytics.batchComparative || []).map((item) => ({
    batch: item.batchName || item.batch || "-",
    avgScore: Number(item.avgScore || 0),
    passRate: Number(item.passRate || 0),
    participationRate: Number(item.participationRate || 0),
    students: Number(item.students || 0),
  }));

  const distribution = useMemo(() => {
    const base = ["0-20", "21-40", "41-60", "61-80", "81-100"].map((range) => ({ range, count: 0 }));
    const map = new Map(base.map((item) => [item.range, item]));
    (analytics.distribution || []).forEach((item) => {
      if (!map.has(item.range)) return;
      map.get(item.range).count = Number(item.count || 0);
    });
    return Array.from(map.values());
  }, [analytics.distribution]);

  const rankedRows = (analytics.tableRows || []).map((row, index) => ({
    rank: Number(row.rank || index + 1),
    name: row.name || "-",
    rollNo: row.rollNo || row.studentId || "-",
    studentId: row.studentId,
    department: row.department || row.departmentName || "-",
    batch: row.batch || row.batchName || "-",
    avgScore: Number(row.avgScore || 0),
    testsTaken: Number(row.testsTaken || 0),
    violations: Number(row.violations || 0),
    violationEvents: Array.isArray(row.violationEvents)
      ? row.violationEvents.map((event) => ({
          id: event.id,
          type: event.type,
          createdAt: event.createdAt,
          metadata: event.metadata || null,
          testName: event.testName || "Test",
          submissionId: event.submissionId || null,
        }))
      : [],
  }));

  const attemptRows = (analytics.attemptHistory || []).map((item) => ({
    id: item.id,
    test: item.testName || item.testTitle || "-",
    score: Number(item.score || 0),
    percentile: item.percentile != null ? Number(item.percentile) : null,
    timeTaken: Number(item.timeTaken || 0),
    date: item.date,
    status: item.status || "-",
  }));

  const selectedStudent = analytics.selectedStudent;
  const totalStudents = Math.max(1, rankedRows.length);
  const percentile = selectedStudent?.rank ? ((totalStudents - Number(selectedStudent.rank) + 1) / totalStudents) * 100 : 0;

  const studentStats = {
    avg: Number(analytics?.metrics?.avgScore || 0),
    percentile,
    rank: selectedStudent?.rank || null,
    violations: Number(analytics?.metrics?.violations || 0),
    totalSubmissions: attemptRows.length,
  };

  const sortedDepartmentRows = sortRows(rankedRows, sortState);
  const sortedBatchRows = sortRows(rankedRows, sortState);
  const sortedAttemptRows = sortRows(attemptRows, sortState);

  const studentMatches = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    if (term.length < 2) return [];
    return studentsDirectory
      .filter((student) => {
        const hay = `${student.fullName || ""} ${student.studentId || ""} ${student.department?.name || ""}`.toLowerCase();
        return hay.includes(term);
      })
      .slice(0, 8);
  }, [studentSearch, studentsDirectory]);

  useEffect(() => {
    setSortState(MODE_DEFAULT_SORT[mode]);
    if (mode !== "student") {
      setStudentSearch("");
    }
  }, [mode]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const startPollingJob = (jobId) => {
    if (!jobId) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await adminApi.getReportJobStatus(jobId);
        setExportState((prev) => ({
          ...prev,
          status: status.status === "completed" ? "complete" : status.status === "failed" ? "failed" : "polling",
          progress: Number(status.progress || 0),
          downloadUrl: status.download_url || prev.downloadUrl || `/api/admin/reports/${jobId}/download`,
          expiresAt: status.expires_at || prev.expiresAt,
          jobId,
        }));

        if (status.status === "completed" || status.status === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (_error) {
        setExportState((prev) => ({ ...prev, status: "failed" }));
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1800);
  };

  const handleExport = async () => {
    if (!canExportReports) return;

    const reportType = mode === "batch" ? "BATCH_WISE" : mode === "student" ? "STUDENT_WISE" : "DEPARTMENT_WISE";

    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });

    try {
      const result = await adminApi.generateReport({
        type: reportType,
        filters: {
          testId: testId === "all" ? undefined : testId,
          batchId: mode === "batch" ? batchId || undefined : undefined,
          studentId: mode === "student" ? studentId || undefined : undefined,
        },
      });

      const jobId = result?.jobId;
      if (!jobId) {
        setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
        return;
      }

      setExportState({ status: "polling", progress: 5, downloadUrl: `/api/admin/reports/${jobId}/download`, expiresAt: null, jobId });
      startPollingJob(jobId);
    } catch (_error) {
      setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
    }
  };

  const handleDownload = async () => {
    if (!exportState.jobId) return;

    try {
      const isExpired = exportState.expiresAt && new Date(exportState.expiresAt).getTime() <= Date.now();
      if (isExpired) {
        const refreshed = await adminApi.regenerateReportLink(exportState.jobId);
        setExportState((prev) => ({
          ...prev,
          downloadUrl: refreshed.resultUrl || prev.downloadUrl,
          expiresAt: refreshed.expiresAt || prev.expiresAt,
        }));
      }

      const blob = await adminApi.downloadReport(exportState.jobId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `admin-report-${exportState.jobId}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (_error) {
      setExportState((prev) => ({ ...prev, status: "failed" }));
    }
  };

  const handleModeSwitch = (nextMode) => {
    updateParams({ mode: nextMode, batch: "", student_id: "" });
  };

  const handleSort = (key) => {
    setSortState((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  };

  const handleViolationClick = (row) => {
    setViolationDialog({
      open: true,
      studentName: row.name || row.studentName || "Student",
      events: Array.isArray(row.violationEvents) ? row.violationEvents : [],
    });
  };

  if (!canViewReports) {
    return <PermissionDenied action="view reports" />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-4 sm:px-6">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Reports & Analytics</h1>
            <p className="text-sm text-text-secondary">Performance and integrity insights across test scopes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-text-secondary">Test</label>
            <select
              value={testId}
              onChange={(event) => updateParams({ test: event.target.value })}
              className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="all">All Tests</option>
              {tests.map((test) => (
                <option key={test.id} value={test.id}>{test.title}</option>
              ))}
            </select>
            <ExportButton
              exportState={exportState}
              onExport={handleExport}
              onDownload={handleDownload}
              disabled={!canExportReports}
              disabledReason={!canExportReports ? "Contact your administrator to request export access" : ""}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {ADMIN_MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => handleModeSwitch(item.key)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                mode === item.key ? "bg-primary text-primary-foreground" : "border border-border bg-background text-text-primary hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          {mode === "batch" ? (
            <select
              value={batchId}
              onChange={(event) => updateParams({ batch: event.target.value })}
              className="h-9 min-w-55 rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="">Select batch</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.name}</option>
              ))}
            </select>
          ) : null}

          {mode === "student" ? (
            <div className="relative flex w-full max-w-md flex-col gap-2">
              <input
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
                placeholder="Search student (name / roll / dept)"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
              />

              {studentSearch.trim().length >= 2 && studentMatches.length > 0 ? (
                <div className="absolute top-10 z-10 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
                  {studentMatches.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => {
                        updateParams({ student_id: student.id });
                        setStudentSearch(student.fullName || "");
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium text-text-primary">{student.fullName}</span>
                      <span className="text-xs text-text-secondary">{student.studentId} · {student.department?.name || "-"}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {studentSearch.trim().length < 2 ? (
                <select
                  value={studentId}
                  onChange={(event) => updateParams({ student_id: event.target.value })}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                >
                  <option value="">Select student</option>
                  {studentsDirectory.map((student) => (
                    <option key={student.id} value={student.id}>{student.fullName} ({student.studentId})</option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {analyticsQuery.isLoading ? (
        <section className="rounded-2xl border border-border bg-card p-4 text-sm text-text-secondary">Loading report data...</section>
      ) : null}

      {analyticsQuery.isError ? (
        <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load report analytics.</section>
      ) : null}

      {!analyticsQuery.isLoading && !analyticsQuery.isError ? (
        <section className="space-y-4">
          {mode !== "student" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Avg Score" value={formatPercent(analytics?.metrics?.avgScore)} sub="Overall score performance" />
              <KpiCard label="Pass Rate" value={formatPercent(analytics?.metrics?.passRate)} sub="Students above pass threshold" />
              <KpiCard label="Participation Rate" value={formatPercent(analytics?.metrics?.participationRate)} sub="Submission completion" />
              <KpiCard
                label="Violations"
                value={Number(analytics?.metrics?.violations || 0)}
                sub="Proctoring flags"
                flag={Number(analytics?.metrics?.violations || 0) > 10}
                flagLabel="High violation volume"
              />
            </div>
          ) : (
            <StudentIdentityCard student={selectedStudent} stats={studentStats} />
          )}

          {mode === "department" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Monthly Score Trend" height="h-[220px]">
                  <AreaTrendChart data={trendData} xKey="month" dataKey="score" name="Avg Score" color="var(--chart-1)" />
                </ChartCard>
                <ChartCard
                  title="Topic-wise Scores"
                  height={topicData.length < 3 ? "h-[180px]" : "h-[220px]"}
                  footer={topicData.length < 3 ? "Fallback to horizontal bars because fewer than 3 topics are available." : ""}
                >
                  {topicData.length < 3 ? <HorizontalBarChart data={topicData} /> : <TopicRadarChart data={topicData} />}
                </ChartCard>
              </div>

              <ChartCard title="Department Comparison" height="h-[200px]">
                <GroupedBarChart
                  data={departmentComparative}
                  xKey="department"
                  series={[
                    { key: "avgScore", label: "Avg Score" },
                    { key: "passRate", label: "Pass Rate" },
                    { key: "participationRate", label: "Participation" },
                  ]}
                />
              </ChartCard>

              <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="rank" sortState={sortState} onSort={handleSort}>Rank</Th>
                      <Th sortKey="name" sortState={sortState} onSort={handleSort}>Name</Th>
                      <Th sortKey="rollNo" sortState={sortState} onSort={handleSort}>Roll No</Th>
                      <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                      <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests Taken</Th>
                      <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDepartmentRows.map((row) => (
                      <tr key={`${row.studentId}-${row.rank}`} className="border-t border-border/70">
                        <td className="px-4 py-3">#{row.rank}</td>
                        <td className="px-4 py-3 font-medium text-text-primary">{row.name}</td>
                        <td className="px-4 py-3 text-text-secondary">{row.rollNo}</td>
                        <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-3">{row.testsTaken}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleViolationClick(row)}
                            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title="View violation details"
                          >
                            <ViolationBadge count={row.violations} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            </>
          ) : null}

          {mode === "batch" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Monthly Score Trend" height="h-[220px]">
                  <LineTrendChart data={trendData} xKey="month" dataKey="score" name="Avg Score" color="var(--chart-2)" />
                </ChartCard>
                <ChartCard title="Score Distribution" height="h-[220px]">
                  <ScoreDonutChart data={distribution} total={rankedRows.length} />
                </ChartCard>
              </div>

              <ChartCard title="Batch Comparison" height="h-[200px]">
                <GroupedBarChart
                  data={batchComparative}
                  xKey="batch"
                  series={[
                    { key: "avgScore", label: "Avg Score" },
                    { key: "passRate", label: "Pass Rate" },
                  ]}
                  highlightCategory={batches.find((item) => item.id === batchId)?.name || ""}
                />
              </ChartCard>

              <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="name" sortState={sortState} onSort={handleSort}>Student</Th>
                      <Th sortKey="rollNo" sortState={sortState} onSort={handleSort}>Roll No</Th>
                      <Th sortKey="department" sortState={sortState} onSort={handleSort}>Dept</Th>
                      <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                      <Th sortKey="rank" sortState={sortState} onSort={handleSort}>Rank</Th>
                      <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests</Th>
                      <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBatchRows.map((row) => (
                      <tr key={`${row.studentId}-${row.rank}`} className="border-t border-border/70">
                        <td className="px-4 py-3 font-medium text-text-primary">{row.name}</td>
                        <td className="px-4 py-3 text-text-secondary">{row.rollNo}</td>
                        <td className="px-4 py-3"><StatusBadge label={row.department} variant="info" /></td>
                        <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-3">#{row.rank}</td>
                        <td className="px-4 py-3">{row.testsTaken}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleViolationClick(row)}
                            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title="View violation details"
                          >
                            <ViolationBadge count={row.violations} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedBatchRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8">
                          <EmptyState
                            title="No students in this batch"
                            description="Add students to this batch to see report rows."
                            action={{ label: "Go to Batch Management", onClick: () => navigate("/admin/batches") }}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </article>
            </>
          ) : null}

          {mode === "student" ? (
            <>
              {!studentId ? (
                <EmptyState title="Select a student" description="Choose a student from the context selector to render personal analytics." />
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                    <ChartCard title="Score Progression" height="h-[220px]">
                      <AreaTrendChart
                        data={attemptRows.map((item) => ({ month: formatDateLabel(item.date), score: item.score }))}
                        xKey="month"
                        dataKey="score"
                        name="Score"
                        refValue={analytics?.metrics?.avgScore}
                        refLabel="Dept Avg"
                        color="var(--chart-2)"
                      />
                    </ChartCard>

                    <ChartCard
                      title="Topic Strengths"
                      height={topicData.length < 3 ? "h-[180px]" : "h-[220px]"}
                      footer={topicData.length < 3 ? "Fallback to horizontal bars because fewer than 3 topics are available." : ""}
                    >
                      {topicData.length < 3 ? <HorizontalBarChart data={topicData} /> : <TopicRadarChart data={topicData} />}
                    </ChartCard>
                  </div>

                  <ChartCard title="Topic Breakdown" height="h-[180px]">
                    <HorizontalBarChart data={topicData} />
                  </ChartCard>

                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <Th sortKey="test" sortState={sortState} onSort={handleSort}>Test</Th>
                          <Th sortKey="score" sortState={sortState} onSort={handleSort}>Score</Th>
                          <Th sortKey="percentile" sortState={sortState} onSort={handleSort}>Percentile</Th>
                          <Th sortKey="timeTaken" sortState={sortState} onSort={handleSort}>Time Taken</Th>
                          <Th sortKey="date" sortState={sortState} onSort={handleSort}>Date</Th>
                          <Th sortKey="status" sortState={sortState} onSort={handleSort}>Status</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAttemptRows.map((row) => (
                          <tr key={row.id} className="border-t border-border/70">
                            <td className="px-4 py-3 font-medium text-text-primary">{row.test}</td>
                            <td className="px-4 py-3"><ScoreBadge score={row.score} /></td>
                            <td className="px-4 py-3">{row.percentile != null ? `${row.percentile.toFixed(1)}%` : "-"}</td>
                            <td className="px-4 py-3">{Math.round(row.timeTaken / 60)} min</td>
                            <td className="px-4 py-3 text-text-secondary">{formatDateLabel(row.date)}</td>
                            <td className="px-4 py-3"><StatusBadge label={row.status} variant={getStatusVariant(row.status)} /></td>
                          </tr>
                        ))}
                        {sortedAttemptRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-8">
                              <EmptyState title="No tests attempted yet in the selected scope." description="Once this student submits tests, attempts will appear here." />
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </article>
                </>
              )}
            </>
          ) : null}

          {!analyticsQuery.isLoading && rankedRows.length === 0 && mode !== "student" ? (
            <EmptyState
              title={`No data for ${testId === "all" ? "all tests" : "selected test"} in selected ${mode}.`}
              description="Try selecting All Tests or switching the context."
              action={{ label: "Reset filters", onClick: () => updateParams({ test: "all", batch: "", student_id: "" }) }}
            />
          ) : null}
        </section>
      ) : null}
      <Dialog
        open={violationDialog.open}
        onOpenChange={(open) => setViolationDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Violation Details</DialogTitle>
            <DialogDescription>
              {violationDialog.studentName} - exam-time violations captured by proctoring.
            </DialogDescription>
          </DialogHeader>

          {violationDialog.events.length === 0 ? (
            <div className="rounded-xl border border-border bg-background p-4 text-sm text-text-secondary">
              No detailed violation events available for this student in the current report scope.
            </div>
          ) : (
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {violationDialog.events.map((event, index) => (
                <div key={event.id || `${event.submissionId || "submission"}-${index}`} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold capitalize text-text-primary">{formatViolationType(event.type)}</p>
                    <p className="text-xs text-text-secondary">{formatDateLabel(event.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">Test: {event.testName || "-"}</p>
                  {event.metadata ? (
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-border/70 bg-card p-2 text-[11px] text-text-secondary">{JSON.stringify(event.metadata, null, 2)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
