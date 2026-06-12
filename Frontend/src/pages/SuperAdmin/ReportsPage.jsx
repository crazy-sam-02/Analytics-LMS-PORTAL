import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { superAdminApi } from "@/services/api";
import {
  AbsentStudentsCard,
  AreaTrendChart,
  ChartCard,
  EmptyState,
  ExportButton,
  GroupedBarChart,
  HorizontalBarChart,
  KpiCard,
  LineTrendChart,
  ScoreBadge,
  StatusBadge,
  Th,
  TopicPieChart,
  ViolationBadge,
} from "@/components/Reports/components";
import { clampPercent, formatDateLabel, formatPercent, toQueryString } from "@/components/Reports/utils";

const REPORT_MODES = [
  { key: "overview", label: "Overview" },
  { key: "departments", label: "Departments" },
  { key: "student", label: "Student" },
];

const MODE_DEFAULT_SORT = {
  overview: { key: "avgScore", dir: "desc" },
  departments: { key: "avgScore", dir: "desc" },
  student: { key: "rank", dir: "asc" },
};
const YEAR_OPTIONS = ["1", "2", "3", "4"];
const STUDENT_SCOPE_OPTIONS = [
  { value: "current", label: "Current" },
  { value: "passout", label: "Passed Out" },
  { value: "all", label: "All" },
];

const NUMERIC_SORT_KEYS = new Set([
  "rank",
  "students",
  "submissions",
  "avgScore",
  "passRate",
  "participation",
  "testsTaken",
  "violations",
  "year",
  "scorePercent",
  "obtainedMarks",
  "timeTaken",
  "violationsCount",
]);

const toNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};

const getSortValue = (row, key) => {
  if (!row) return null;
  if (key === "date") {
    const time = new Date(row.date || 0).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (NUMERIC_SORT_KEYS.has(key)) return toNumber(row[key]);
  return row[key] ?? null;
};

const sortRows = (rows, sortState) => {
  if (!Array.isArray(rows) || !rows.length) return [];
  const { key, dir } = sortState || {};
  if (!key) return [...rows];
  const factor = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = getSortValue(a, key);
    const bv = getSortValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
};

function RecentExports({ reports, onDownload }) {
  const rows = Array.isArray(reports) ? reports.slice(0, 4) : [];

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Recent Exports</h3>
        <p className="text-xs text-text-secondary">Generated PDFs for super admin reports.</p>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((job) => {
            const status = String(job.status || "QUEUED").toLowerCase();
            return (
              <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{String(job.type || "REPORT").replace(/_/g, " ")}</p>
                  <p className="text-xs text-text-secondary">{formatDateLabel(job.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={status} variant={status === "completed" ? "success" : status === "failed" ? "danger" : "warning"} />
                  {status === "completed" ? (
                    <button
                      type="button"
                      onClick={() => onDownload(job.id)}
                      className="rounded-lg border border-border px-3 py-1 text-xs font-semibold hover:bg-muted"
                    >
                      Download
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No exports yet" description="Generated report PDFs will appear here." />
      )}
    </article>
  );
}

function StudentSummary({ student, metrics }) {
  if (!student) return null;
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-xl font-bold text-chart-1">
          {String(student.name || "?")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-text-primary">{student.name}</p>
          <p className="text-xs text-text-secondary">
            {student.studentId || "-"} - {student.college || "-"} - {student.department || "-"} - {student.batch || "-"}
          </p>
          <p className="text-xs text-text-secondary">Year: {student.year ? `${student.year} YEAR` : "-"}</p>
        </div>
        <div className="grid min-w-60 grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-primary">{formatPercent(metrics?.avgScore)}</p>
            <p className="text-[11px] text-text-secondary">avg score</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-primary">#{student.rank || "-"}</p>
            <p className="text-[11px] text-text-secondary">rank</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-text-primary">{toNumber(metrics?.totalSubmissions)}</p>
            <p className="text-[11px] text-text-secondary">attempts</p>
          </div>
          <div>
            <p className={`text-2xl font-bold tabular-nums ${toNumber(metrics?.violations) > 0 ? "text-red-500" : "text-green-500"}`}>
              {toNumber(metrics?.violations)}
            </p>
            <p className="text-[11px] text-text-secondary">violations</p>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = REPORT_MODES.some((item) => item.key === searchParams.get("mode")) ? searchParams.get("mode") : "overview";
  const collegeId = searchParams.get("college") || "";
  const departmentId = searchParams.get("department") || "";
  const testId = searchParams.get("test") || "all";
  const studentId = searchParams.get("student_id") || "";
  const rawStudentScope = searchParams.get("student_scope") || "current";
  const studentScope = STUDENT_SCOPE_OPTIONS.some((item) => item.value === rawStudentScope) ? rawStudentScope : "current";
  const passoutYear = searchParams.get("passout_year") || "";
  const passoutCohortId = searchParams.get("passout_cohort") || "";
  const hasCollegeSelected = Boolean(collegeId);

  const [studentSearch, setStudentSearch] = useState("");
  const [studentYear, setStudentYear] = useState("");
  const [studentVisibleLimit, setStudentVisibleLimit] = useState(100);
  const [sortState, setSortState] = useState(MODE_DEFAULT_SORT[mode]);
  const [error, setError] = useState(null);
  const [exportState, setExportState] = useState({
    status: "idle",
    progress: 0,
    downloadUrl: "",
    expiresAt: null,
    jobId: "",
  });
  const pollRef = useRef(null);

  const updateParams = (next) => {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "" || value === "all") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });
    setSearchParams(nextParams);
  };

  const collegesQuery = useQuery({
    queryKey: ["super-report-colleges-v4"],
    queryFn: () => superAdminApi.getColleges("?page=1&limit=100"),
    staleTime: 120000,
  });

  const departmentsQuery = useQuery({
    queryKey: ["super-report-departments-v4", collegeId],
    queryFn: () => superAdminApi.getDepartments(toQueryString({ page: 1, limit: 100, collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  const testsQuery = useQuery({
    queryKey: ["super-report-tests-v4", collegeId],
    queryFn: () => superAdminApi.getTests(toQueryString({ page: 1, limit: 100, collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  const passoutCohortsQuery = useQuery({
    queryKey: ["super-report-passout-cohorts-v1", collegeId],
    queryFn: () => superAdminApi.getPassoutCohorts(toQueryString({ collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 120000,
  });

  const scopeQuery = useQuery({
    queryKey: ["super-report-analytics-scope-v4", collegeId, departmentId, testId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAnalytics(
        toQueryString({
          collegeId,
          departmentId,
          testId,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected,
    staleTime: 45000,
  });

  const studentDetailQuery = useQuery({
    queryKey: ["super-report-student-detail-v4", collegeId, departmentId, testId, studentId, studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getReportAnalytics(
        toQueryString({
          collegeId,
          departmentId,
          testId,
          studentId,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && Boolean(studentId),
    staleTime: 45000,
  });

  const studentSearchQuery = useQuery({
    queryKey: ["super-report-student-search-v4", collegeId, departmentId, studentSearch.trim(), studentYear, studentScope, passoutYear, passoutCohortId],
    queryFn: () =>
      superAdminApi.getStudents(
        toQueryString({
          page: 1,
          limit: 10,
          collegeId,
          departmentId,
          search: studentSearch.trim(),
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        })
      ),
    enabled: hasCollegeSelected && mode === "student" && studentSearch.trim().length >= 2,
    staleTime: 30000,
  });

  const reportsQuery = useQuery({
    queryKey: ["super-report-jobs-v4", collegeId],
    queryFn: () => superAdminApi.getReports(toQueryString({ collegeId })),
    enabled: hasCollegeSelected,
    staleTime: 30000,
  });

  const colleges = useMemo(() => (Array.isArray(collegesQuery.data?.data) ? collegesQuery.data.data : []), [collegesQuery.data]);
  const departments = useMemo(() => (Array.isArray(departmentsQuery.data?.data) ? departmentsQuery.data.data : []), [departmentsQuery.data]);
  const tests = useMemo(() => (Array.isArray(testsQuery.data?.data) ? testsQuery.data.data : []), [testsQuery.data]);
  const passoutCohorts = Array.isArray(passoutCohortsQuery.data?.data) ? passoutCohortsQuery.data.data : [];
  const passoutYearOptions = [...new Set(passoutCohorts.map((cohort) => String(cohort.passoutYear || "")).filter(Boolean))];
  const visiblePassoutCohorts = passoutCohorts.filter((cohort) => !passoutYear || String(cohort.passoutYear) === String(passoutYear));
  const scope = scopeQuery.data || {};
  const studentDetail = studentDetailQuery.data || {};
  const reports = Array.isArray(reportsQuery.data) ? reportsQuery.data : [];

  const metrics = scope.metrics || {};
  const departmentSourceRows = scope.departmentRows;
  const studentSourceRows = scope.tableRows;
  const departmentRows = useMemo(
    () => (Array.isArray(departmentSourceRows) ? departmentSourceRows : []).map((row) => ({
      departmentId: row.departmentId,
      college: row.college || "-",
      department: row.department || "-",
      students: toNumber(row.students),
      submissions: toNumber(row.submissions),
      avgScore: clampPercent(row.avgScore),
      passRate: clampPercent(row.passRate),
      participation: clampPercent(row.participation),
      violations: toNumber(row.violations),
    })),
    [departmentSourceRows]
  );

  const studentRows = useMemo(
    () => (Array.isArray(studentSourceRows) ? studentSourceRows : []).map((row) => ({
      rank: row.rank,
      studentId: row.studentId,
      name: row.name || "-",
      rollNo: row.rollNo || "-",
      collegeId: row.collegeId,
      college: row.college || "-",
      departmentId: row.departmentId,
      department: row.department || "-",
      batch: row.batch || "-",
      year: row.year || null,
      avgScore: clampPercent(row.avgScore),
      testsTaken: toNumber(row.testsTaken),
      participation: toNumber(row.participation),
      violations: toNumber(row.violations),
    })),
    [studentSourceRows]
  );

  const selectedTestName = useMemo(() => {
    if (testId === "all") return "";
    return tests.find((test) => String(test.id) === String(testId))?.title || "";
  }, [testId, tests]);

  const showNotAttendedCard = mode !== "student" && testId !== "all";
  const notAttendedStudents = useMemo(() => {
    if (!showNotAttendedCard) return [];
    return studentRows
      .filter((row) => row.testsTaken === 0)
      .map((row) => ({
        studentId: row.studentId,
        name: row.name,
        rollNo: row.rollNo,
        department: row.department,
        batch: row.batch,
      }));
  }, [showNotAttendedCard, studentRows]);

  const trendData = (scope.scoreTrend || []).map((item, index) => ({
    month: item.month || `Period ${index + 1}`,
    score: clampPercent(item.score),
  }));

  const subjectData = (scope.subjectPerformance || []).map((item) => ({
    subject: item.subject || "General",
    score: clampPercent(item.score),
  }));

  const selectedDepartment = departments.find((item) => String(item.id) === String(departmentId)) || null;
  const selectedCollege = colleges.find((item) => String(item.id) === String(collegeId)) || null;
  const studentMatches = studentSearchQuery.data?.data || [];
  const selectedStudent = studentDetail.selectedStudent || null;
  const selectedStudentMetrics = studentDetail.metrics || {};
  const attemptRows = (studentDetail.attemptHistory || []).map((row) => ({
    id: row.id,
    testName: row.testName || "-",
    subject: row.subject || "-",
    scorePercent: clampPercent(row.scorePercent),
    obtainedMarks: toNumber(row.obtainedMarks),
    totalMarks: toNumber(row.totalMarks),
    timeTaken: toNumber(row.timeTaken),
    status: row.status || "-",
    date: row.date,
    violationsCount: toNumber(row.violationsCount),
    questionAnalysis: row.questionAnalysis || { correct: 0, total: 0 },
  }));

  const sortedDepartmentRows = sortRows(departmentRows, sortState);
  const sortedStudentRows = sortRows(studentRows, sortState);
  const sortedAttemptRows = sortRows(attemptRows, sortState);
  const visibleStudentRows = sortedStudentRows.slice(0, studentVisibleLimit);

  const departmentChartRows = [...departmentRows]
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 12)
    .map((row) => ({
      department: row.department,
      avgScore: clampPercent(row.avgScore),
      passRate: clampPercent(row.passRate),
      participation: clampPercent(row.participation),
    }));

  useEffect(() => {
    setSortState(MODE_DEFAULT_SORT[mode]);
    if (mode !== "student") setStudentSearch("");
    setStudentVisibleLimit(100);
  }, [mode]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPollingJob = (jobId) => {
    if (!jobId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const jobs = await superAdminApi.getReports(toQueryString({ collegeId }));
        const job = (jobs || []).find((item) => item.id === jobId);
        if (!job) return;
        const normalized = String(job.status || "").toLowerCase();
        setExportState((prev) => ({
          ...prev,
          status: normalized === "completed" ? "complete" : normalized === "failed" ? "failed" : "polling",
          progress: normalized === "completed" ? 100 : normalized === "processing" ? 60 : 15,
          downloadUrl: job.resultUrl || job.downloadUrl || prev.downloadUrl || `/api/super-admin/reports/${jobId}/download`,
          expiresAt: job.downloadExpiresAt || job?.filters?.resultUrlExpiresAt || prev.expiresAt,
          jobId,
        }));
        if (normalized === "completed" || normalized === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          reportsQuery.refetch();
        }
      } catch (_error) {
        setExportState((prev) => ({ ...prev, status: "failed" }));
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1800);
  };

  const handleExport = async () => {
    const reportType = mode === "student" ? "STUDENT_WISE" : mode === "departments" ? "DEPARTMENT_WISE" : "TEST_WISE";

    if (!collegeId) {
      setError("Select a college before exporting a report.");
      return;
    }

    if (mode === "student" && !studentId) {
      setError("Select a student before exporting a student report.");
      return;
    }

    setError(null);
    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });

    try {
      const result = await superAdminApi.generateReport({
        type: reportType,
        filters: {
          collegeId: collegeId || undefined,
          departmentId: departmentId || undefined,
          studentId: mode === "student" ? studentId || undefined : undefined,
          testId: testId === "all" ? undefined : testId,
          year: studentYear || undefined,
          studentScope,
          passoutYear: passoutYear || undefined,
          passoutCohortId: passoutCohortId || undefined,
        },
      });
      const jobId = result?.jobId || result?.id;
      if (!jobId) {
        setError("Failed to create report job.");
        setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
        return;
      }
      setExportState({ status: "polling", progress: 5, downloadUrl: `/api/super-admin/reports/${jobId}/download`, expiresAt: null, jobId });
      startPollingJob(jobId);
    } catch (err) {
      setError(err?.message || "Failed to generate report.");
      setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
    }
  };

  const downloadJob = async (jobId) => {
    try {
      const blob = await superAdminApi.downloadReport(jobId);
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `super-admin-report-${jobId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err?.message || "Failed to download report.");
    }
  };

  const handleDownload = async () => {
    if (!exportState.jobId) return;
    const isExpired = exportState.expiresAt && new Date(exportState.expiresAt).getTime() <= Date.now();
    if (isExpired) {
      const refreshed = await superAdminApi.regenerateReportLink(exportState.jobId);
      setExportState((prev) => ({ ...prev, downloadUrl: refreshed.resultUrl || prev.downloadUrl, expiresAt: refreshed.expiresAt || prev.expiresAt }));
    }
    await downloadJob(exportState.jobId);
  };

  const handleSort = (key) => {
    setSortState((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "asc" };
    });
  };

  const handleModeSwitch = (nextMode) => {
    updateParams({
      mode: nextMode,
      department: nextMode === "overview" ? "" : departmentId,
      student_id: "",
    });
  };

  const handleCollegeChange = (nextCollegeId) => {
    updateParams({ college: nextCollegeId, department: "", test: "all", passout_year: "", passout_cohort: "", student_id: "" });
  };

  const handleDepartmentChange = (nextDepartmentId) => {
    updateParams({ department: nextDepartmentId, student_id: "" });
  };

  const handleYearChange = (nextYear) => {
    setStudentYear(nextYear || "");
    updateParams({ student_id: "" });
    setStudentSearch("");
  };

  const handleStudentScopeChange = (nextScope) => {
    updateParams({
      student_scope: nextScope === "current" ? "" : nextScope,
      passout_year: nextScope === "current" ? "" : passoutYear,
      passout_cohort: nextScope === "current" ? "" : passoutCohortId,
      student_id: "",
    });
    setStudentSearch("");
  };

  const handlePassoutYearChange = (nextYear) => {
    updateParams({ passout_year: nextYear || "", passout_cohort: "", student_id: "" });
    setStudentSearch("");
  };

  const handlePassoutCohortChange = (nextCohortId) => {
    updateParams({ passout_cohort: nextCohortId || "", student_id: "" });
    setStudentSearch("");
  };

  const loading = collegesQuery.isLoading || (hasCollegeSelected && scopeQuery.isLoading);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-4 sm:px-6">
      {error ? (
        <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">{error}</section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Super Admin Reports</h1>
            <p className="text-sm text-text-secondary">
              College, department, and student performance reports with simple readable metrics.
            </p>
          </div>
          <ExportButton
            exportState={exportState}
            onExport={handleExport}
            onDownload={handleDownload}
            disabled={!hasCollegeSelected}
            disabledReason={!hasCollegeSelected ? "Select a college before exporting reports." : ""}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {REPORT_MODES.map((item) => (
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

        <div className="grid gap-3 md:grid-cols-5 xl:grid-cols-6">
          <label className="space-y-1 text-xs text-text-secondary">
            <span>College</span>
            <select
              value={collegeId}
              onChange={(event) => handleCollegeChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
            >
              <option value="">Select College</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Department</span>
            <select
              value={departmentId}
              onChange={(event) => handleDepartmentChange(event.target.value)}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="">{collegeId ? "All Departments" : "Select a college first"}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Test</span>
            <select
              value={testId}
              onChange={(event) => updateParams({ test: event.target.value })}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="all">{collegeId ? "All Tests" : "Select a college first"}</option>
              {tests.map((test) => (
                <option key={test.id} value={test.id}>{test.title}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Student Scope</span>
            <select
              value={studentScope}
              onChange={(event) => handleStudentScopeChange(event.target.value)}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              {STUDENT_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {studentScope !== "current" ? (
            <>
              <label className="space-y-1 text-xs text-text-secondary">
                <span>Passout Year</span>
                <select
                  value={passoutYear}
                  onChange={(event) => handlePassoutYearChange(event.target.value)}
                  disabled={!collegeId}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
                >
                  <option value="">{collegeId ? "All passout years" : "Select a college first"}</option>
                  {passoutYearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-text-secondary">
                <span>Passout Cohort</span>
                <select
                  value={passoutCohortId}
                  onChange={(event) => handlePassoutCohortChange(event.target.value)}
                  disabled={!collegeId}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
                >
                  <option value="">{collegeId ? "All cohorts" : "Select a college first"}</option>
                  {visiblePassoutCohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.academicLabel || cohort.passoutYear} ({cohort.totalStudents || 0})
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <label className="space-y-1 text-xs text-text-secondary">
            <span>Student Year</span>
            <select
              value={studentYear}
              onChange={(event) => handleYearChange(event.target.value)}
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-text-primary disabled:opacity-60"
            >
              <option value="">{collegeId ? "All years" : "Select a college first"}</option>
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year} YEAR</option>
              ))}
            </select>
          </label>
        </div>

        {mode === "student" ? (
          <div className="relative max-w-xl">
            <input
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="Search student by name, email, or roll number"
              disabled={!collegeId}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm disabled:opacity-60"
            />
            {studentSearch.trim().length >= 2 ? (
              <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {studentMatches.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      updateParams({
                        college: student.collegeId || collegeId,
                        department: student.departmentId || "",
                        student_id: student.id,
                      });
                      setStudentSearch("");
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-medium text-text-primary">{student.fullName}</span>
                    <span className="block text-xs text-text-secondary">
                      {student.studentId || "-"} - {student.college?.name || selectedCollege?.name || "-"} - {student.department?.name || "-"} - {student.year || "-"}
                    </span>
                  </button>
                ))}
                {!studentSearchQuery.isLoading && studentMatches.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-text-secondary">No students found.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {loading ? <section className="rounded-2xl border border-border bg-card p-4 text-sm text-text-secondary">Loading report data...</section> : null}
      {hasCollegeSelected && scopeQuery.isError ? <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">Unable to load report data.</section> : null}

      {!hasCollegeSelected && !collegesQuery.isLoading ? (
        <section className="rounded-2xl border border-border bg-card">
          <EmptyState title="Select a college" description="Choose a college first to view reports for that college." />
        </section>
      ) : null}

      {hasCollegeSelected && !loading && !scopeQuery.isError ? (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Students" value={toNumber(metrics.totalStudents).toLocaleString()} sub="Current scope" />
            <KpiCard label="Avg Score" value={formatPercent(metrics.avgScore)} sub="Submitted attempts" />
            <KpiCard label="Pass Rate" value={formatPercent(metrics.passRate)} sub="Score 40% and above" />
            <KpiCard
              label="Violations"
              value={toNumber(metrics.violations)}
              sub="Integrity flags"
              flag={toNumber(metrics.violations) > 10}
            />
          </div>

          {mode === "overview" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Score Trend" height="h-[220px]">
                  <AreaTrendChart data={trendData} xKey="month" dataKey="score" name="Avg Score" color="var(--chart-1)" />
                </ChartCard>
                <ChartCard title="Topic-wise Performance" height="h-[220px]">
                  <TopicPieChart data={subjectData} />
                </ChartCard>
              </div>

              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title={collegeId ? "Department Overview" : "Department Overview Across Colleges"} height="h-[240px]">
                  <div className="h-full p-4 bg-white rounded-md overflow-auto">
                    <GroupedBarChart
                      data={departmentChartRows}
                      xKey="department"
                      series={[
                        { key: "avgScore", label: "Avg Score" },
                        { key: "passRate", label: "Pass Rate" },
                        { key: "participation", label: "Participation" },
                      ]}
                    />
                  </div>
                </ChartCard>
                <RecentExports reports={reports} onDownload={downloadJob} />
              </div>

              
            </>
          ) : null}

          {mode === "departments" ? (
            <>
              {!collegeId ? (
                <EmptyState title="Select a college" description="Choose a college to view all departments or one particular department." />
              ) : (
                <>
                  <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                    <ChartCard title={selectedDepartment ? `${selectedDepartment.name} Performance` : "All Departments Performance"} height="h-[240px]">
                      <div className="h-full p-4 bg-white rounded-md overflow-auto">
                        <GroupedBarChart
                          data={departmentChartRows}
                          xKey="department"
                          series={[
                            { key: "avgScore", label: "Avg Score" },
                            { key: "passRate", label: "Pass Rate" },
                          ]}
                        />
                      </div>
                    </ChartCard>
                    <ChartCard title="Topic-wise Performance" height="h-[240px]">
                      <TopicPieChart data={subjectData} />
                    </ChartCard>
                  </div>

                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                          <Th sortKey="students" sortState={sortState} onSort={handleSort}>Students</Th>
                          <Th sortKey="submissions" sortState={sortState} onSort={handleSort}>Submissions</Th>
                          <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                          <Th sortKey="passRate" sortState={sortState} onSort={handleSort}>Pass Rate</Th>
                          <Th sortKey="participation" sortState={sortState} onSort={handleSort}>Participation</Th>
                          <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDepartmentRows.map((row) => (
                          <tr key={row.departmentId || row.department} className="border-t border-border/70">
                            <td className="px-4 py-3 font-medium text-text-primary">{row.department}</td>
                            <td className="px-4 py-3">{row.students}</td>
                            <td className="px-4 py-3">{row.submissions}</td>
                            <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                            <td className="px-4 py-3">{formatPercent(row.passRate)}</td>
                            <td className="px-4 py-3">{formatPercent(row.participation)}</td>
                            <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                          </tr>
                        ))}
                        {sortedDepartmentRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8">
                              <EmptyState title="No department reports yet" description="Department metrics appear after students submit tests." />
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

          {mode === "student" ? (
            <>
              

              {!studentId ? (
                <EmptyState title="Select a student" description="Search above or click a student row to view test-by-test performance." />
              ) : studentDetailQuery.isLoading ? (
                <section className="rounded-2xl border border-border bg-card p-4 text-sm text-text-secondary">Loading student performance...</section>
              ) : (
                <>
                  <StudentSummary student={selectedStudent} metrics={selectedStudentMetrics} />

                  <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                    <ChartCard title="Student Score Trend" height="h-[220px]">
                      <LineTrendChart
                        data={attemptRows.map((row) => ({ month: formatDateLabel(row.date), score: row.scorePercent })).reverse()}
                        xKey="month"
                        dataKey="score"
                        name="Score"
                        color="var(--chart-2)"
                      />
                    </ChartCard>
                    <ChartCard title="Topic-wise Performance" height="h-[220px]">
                      <TopicPieChart data={(studentDetail.subjectPerformance || []).map((row) => ({ subject: row.subject, score: toNumber(row.score) }))} />
                    </ChartCard>
                  </div>

                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <Th sortKey="date" sortState={sortState} onSort={handleSort}>Date</Th>
                          <Th sortKey="testName" sortState={sortState} onSort={handleSort}>Test</Th>
                          <Th sortKey="subject" sortState={sortState} onSort={handleSort}>Subject</Th>
                          <Th sortKey="scorePercent" sortState={sortState} onSort={handleSort}>Score</Th>
                          <Th sortKey="obtainedMarks" sortState={sortState} onSort={handleSort}>Marks</Th>
                          <Th sortKey="timeTaken" sortState={sortState} onSort={handleSort}>Time</Th>
                          <Th sortKey="violationsCount" sortState={sortState} onSort={handleSort}>Violations</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAttemptRows.map((row) => (
                          <tr key={row.id} className="border-t border-border/70">
                            <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDateLabel(row.date)}</td>
                            <td className="px-4 py-3 font-medium text-text-primary">{row.testName}</td>
                            <td className="px-4 py-3 text-text-secondary">{row.subject}</td>
                            <td className="px-4 py-3"><ScoreBadge score={row.scorePercent} /></td>
                            <td className="px-4 py-3">
                              {row.totalMarks > 0 ? `${row.obtainedMarks.toFixed(2)} / ${row.totalMarks.toFixed(2)}` : "-"}
                            </td>
                            <td className="px-4 py-3">{Math.round(row.timeTaken / 60)} min</td>
                            <td className="px-4 py-3"><ViolationBadge count={row.violationsCount} /></td>
                          </tr>
                        ))}
                        {sortedAttemptRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8">
                              <EmptyState title="No submitted tests" description="This student's completed tests will appear here." />
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </article>
                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">Students in Scope</h3>
                    <p className="text-xs text-text-secondary">Select a student from search to open complete test performance.</p>
                  </div>
                </div>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="rank" sortState={sortState} onSort={handleSort}>Rank</Th>
                      <Th sortKey="name" sortState={sortState} onSort={handleSort}>Student</Th>
                      <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                      <Th sortKey="year" sortState={sortState} onSort={handleSort}>Year</Th>
                      <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                      <Th sortKey="testsTaken" sortState={sortState} onSort={handleSort}>Tests</Th>
                      <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudentRows.map((row) => (
                      <tr key={row.studentId} className="border-t border-border/70">
                        <td className="px-4 py-3">{row.rank ? `#${row.rank}` : "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => updateParams({ college: row.collegeId || collegeId || "", department: row.departmentId || departmentId, student_id: row.studentId })}
                            className="text-left font-medium text-text-primary hover:text-chart-1"
                          >
                            {row.name}
                            <span className="block text-xs font-normal text-text-secondary">{row.rollNo}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{row.department}</td>
                        <td className="px-4 py-3 text-text-secondary">{row.year ? `${row.year} YEAR` : "-"}</td>
                        <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-3">{row.testsTaken}</td>
                        <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedStudentRows.length > visibleStudentRows.length ? (
                  <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-text-secondary">
                    <span>Showing {visibleStudentRows.length} of {sortedStudentRows.length} students.</span>
                    <button
                      type="button"
                      onClick={() => setStudentVisibleLimit((value) => value + 100)}
                      className="rounded-lg border border-border px-3 py-1 font-semibold text-text-primary hover:bg-muted"
                    >
                      Show more
                    </button>
                  </div>
                ) : null}
              </article>
                </>
              )}
            </>
          ) : null}
          {showNotAttendedCard ? (
            <AbsentStudentsCard
              title={selectedTestName ? `Not Attended: ${selectedTestName}` : "Not Attended Students"}
              subtitle="Students who did not submit the selected test."
              students={notAttendedStudents}
              count={notAttendedStudents.length}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
