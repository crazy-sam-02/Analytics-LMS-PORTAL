import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import usePermission from "@/hooks/usePermission";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import { adminApi } from "@/services/api";
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
  ScoreDonutChart,
  StatusBadge,
  StudentIdentityCard,
  Th,
  TopicPieChart,
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

const clampPercent = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
};
const NUMERIC_SORT_KEYS = new Set(["rank", "avgScore", "testsTaken", "violations", "scorePercent", "percentile", "timeTaken", "violationsCount"]);

const getSortValue = (row, key) => {
  if (!row) return null;
  if (key === "date") {
    const time = new Date(row.date || 0).getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (NUMERIC_SORT_KEYS.has(key)) {
    const numeric = Number(row[key]);
    return Number.isFinite(numeric) ? numeric : null;
  }
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
const TOPIC_LABEL_MAP = {
  aptitute: "Aptitude",
  aptitude: "Aptitude",
  dbms: "DBMS",
};
const YEAR_OPTIONS = ["1", "2", "3", "4"];
const formatTopicLabel = (label, index) => {
  const raw = String(label || "").trim();
  if (!raw) return `Topic ${index + 1}`;
  const key = raw.toLowerCase();
  return TOPIC_LABEL_MAP[key] || raw;
};

export default function ReportsPage({ basePathOverride = null, showStudentDepartmentFilter = false } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = basePathOverride || (location.pathname.startsWith("/college-admin") ? "/college-admin" : "/admin");
  const apiBasePath = `/api${basePath}`;
  const queryKeyPrefix = basePath === "/college-admin" ? "college-admin-report" : "admin-report";
  const [searchParams, setSearchParams] = useSearchParams();

  const canViewReports = usePermission(ADMIN_PERMISSIONS.VIEW_REPORTS);
  const canExportReports = usePermission(ADMIN_PERMISSIONS.EXPORT_REPORTS);

  const mode = ADMIN_MODES.some((item) => item.key === searchParams.get("mode")) ? searchParams.get("mode") : "department";
  const testId = searchParams.get("test") || "all";
  const batchId = searchParams.get("batch") || "";
  const studentId = searchParams.get("student_id") || "";

  const [studentSearch, setStudentSearch] = useState("");
  const [studentYear, setStudentYear] = useState("");
  const [studentDepartmentId, setStudentDepartmentId] = useState("");
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
  const [reviewState, setReviewState] = useState({
    eventKey: "",
    action: "",
    reason: "",
    submitting: false,
    error: "",
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
    queryKey: [`${queryKeyPrefix}-tests-v2`],
    queryFn: () => adminApi.getTests("?page=1&limit=100"),
    staleTime: 120000,
  });

  const batchesQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-batches-v2`],
    queryFn: () => adminApi.getBatches(),
    staleTime: 120000,
  });

  const departmentsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-departments-v2`],
    queryFn: () => adminApi.getDepartments(),
    enabled: canViewReports && mode === "student" && showStudentDepartmentFilter,
    staleTime: 120000,
  });

  const studentsDirectoryQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-students-directory-v2`, studentYear, studentDepartmentId],
    queryFn: () =>
      adminApi.getStudents(
        toQueryString({
          page: 1,
          limit: 100,
          year: studentYear || undefined,
          departmentId: studentDepartmentId || undefined,
        })
      ),
    staleTime: 120000,
  });
  const studentSearchTerm = studentSearch.trim();
  const studentSearchQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-student-search-v2`, studentSearchTerm, studentYear, studentDepartmentId],
    queryFn: () =>
      adminApi.getStudents(
        toQueryString({
          page: 1,
          limit: 8,
          search: studentSearchTerm,
          year: studentYear || undefined,
          departmentId: studentDepartmentId || undefined,
        })
      ),
    enabled: canViewReports && mode === "student" && studentSearchTerm.length >= 2,
    staleTime: 30000,
  });

  const analyticsQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-analytics-v2`, mode, testId, batchId, studentId, studentYear],
    queryFn: () =>
      adminApi.getReportAnalytics(
        toQueryString({
          mode,
          testId,
          batchId,
          studentId,
          year: studentYear || undefined,
        })
      ),
    enabled: canViewReports && (mode !== "student" || Boolean(studentId)),
    staleTime: 45000,
  });
  const studentDetailQuery = useQuery({
    queryKey: [`${queryKeyPrefix}-student-detail-all-tests-v2`, studentId, studentYear],
    queryFn: () => adminApi.getReportStudentDetail(studentId, toQueryString({ year: studentYear || undefined })),
    enabled: canViewReports && mode === "student" && Boolean(studentId),
    staleTime: 45000,
  });

  const tests = testsQuery.data?.data || [];
  const batches = batchesQuery.data || [];
  const departments = Array.isArray(departmentsQuery.data) ? departmentsQuery.data : [];
  const studentsDirectoryData = studentsDirectoryQuery.data?.data;
  const studentSearchData = studentSearchQuery.data?.data;
  const studentsDirectory = useMemo(
    () => (Array.isArray(studentsDirectoryData) ? studentsDirectoryData : []),
    [studentsDirectoryData]
  );
  const studentSearchResults = useMemo(
    () => (Array.isArray(studentSearchData) ? studentSearchData : []),
    [studentSearchData]
  );
  const analytics = analyticsQuery.data || {};
  const notAttended = analytics?.notAttended || {};
  const notAttendedStudents = Array.isArray(notAttended.students) ? notAttended.students : [];
  const showNotAttendedCard = mode !== "student" && testId !== "all";
  const selectedDirectoryStudent = useMemo(
    () => studentsDirectory.find((student) => String(student.id) === String(studentId)) || null,
    [studentsDirectory, studentId]
  );
  const selectedStudentBatchLabel = selectedDirectoryStudent
    ? Array.isArray(selectedDirectoryStudent.batches) && selectedDirectoryStudent.batches.length > 0
      ? selectedDirectoryStudent.batches.map((batch) => batch.name).join(", ")
      : selectedDirectoryStudent.batch?.name || "-"
    : "-";
  const selectedStudentPickerRecord =
    selectedDirectoryStudent ||
    (studentDetailQuery.data?.student
      ? {
          id: studentDetailQuery.data.student.id,
          fullName: studentDetailQuery.data.student.name,
          studentId: studentDetailQuery.data.student.studentId,
          year: studentDetailQuery.data.student.year || null,
          department: { name: studentDetailQuery.data.student.department },
          batch: { name: studentDetailQuery.data.student.batch },
        }
      : null);

  const trendData = (analytics.scoreTrend || []).map((item, index) => ({
    month: item.month || `Test ${index + 1}`,
    score: clampPercent(item.score || 0),
  }));

  const topicData = (analytics.topicPerformance || []).map((item, index) => ({
    subject: formatTopicLabel(item.subject || item.topic, index),
    score: Number(item.score || item.avgScore || 0),
  }));

  const departmentComparative = (analytics.departmentComparative || []).map((item) => ({
    department: item.departmentName || item.department || "-",
    avgScore: clampPercent(item.avgScore || 0),
    passRate: clampPercent(item.passRate || 0),
    participationRate: Number(item.participationRate || 0),
    violations: Number(item.violations || 0),
    students: Number(item.students || 0),
  }));

  const batchComparative = (analytics.batchComparative || []).map((item) => ({
    batch: item.batchName || item.batch || "-",
    avgScore: clampPercent(item.avgScore || 0),
    passRate: clampPercent(item.passRate || 0),
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
    avgScore: clampPercent(row.avgScore || 0),
    testsTaken: Number(row.testsTaken || 0),
    violations: Number(row.violations || 0),
    violationEvents: Array.isArray(row.violationEvents)
      ? row.violationEvents.map((event) => ({
          id: event.id,
          type: event.type,
          anomalyId: event.anomalyId || event.id,
          anomalyType: event.anomalyType || event.type,
          createdAt: event.createdAt,
          metadata: event.metadata || null,
          testName: event.testName || "Test",
          submissionId: event.submissionId || null,
        }))
      : [],
  }));

  const attemptRows = (analytics.attemptHistory || []).map((item) => ({
    id: item.id,
    testId: item.testId,
    testName: item.testName || item.testTitle || "-",
    scorePercent: clampPercent(item.scorePercent || 0),
    percentile: item.percentile != null ? Number(item.percentile) : null,
    timeTaken: Number(item.timeTaken || 0),
    date: item.date,
    status: item.status || "-",
    violationsCount: Number(item.violationsCount || 0),
    violationEvents: Array.isArray(item.violationEvents) ? item.violationEvents : [],
  }));
  const studentReportRows = useMemo(
    () =>
      (studentDetailQuery.data?.tests || [])
        .map((item) => ({
          id: item.id,
          testId: item.testId,
          testName: item.testName || "-",
          scorePercent: clampPercent(item.scorePercent ?? item.accuracy ?? 0),
          percentile: item.percentile != null ? Number(item.percentile) : null,
          timeTaken: Number(item.timeTaken || 0),
          date: item.date,
          status: item.status || "-",
          violationsCount: Number(item.violationsCount || 0),
          violationEvents: Array.isArray(item.violationEvents) ? item.violationEvents : [],
          questionAnalysis: item.questionAnalysis || { correct: 0, incorrect: 0, total: 0 },
        }))
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
    [studentDetailQuery.data]
  );

  const selectedStudent = analytics.selectedStudent || studentDetailQuery.data?.student || null;
  const totalStudents = Math.max(1, rankedRows.length);
  const percentile = selectedStudent?.rank ? ((totalStudents - Number(selectedStudent.rank) + 1) / totalStudents) * 100 : 0;

  const studentStats = {
    avg: Number(analytics?.metrics?.avgScore || 0),
    percentile,
    rank: selectedStudent?.rank || null,
    violations: Number(analytics?.metrics?.violations || 0),
    totalSubmissions: studentReportRows.length || attemptRows.length,
  };
  const studentSummary = useMemo(() => {
    if (!studentReportRows.length) {
      return { best: null, worst: null, total: 0, violations: 0 };
    }
    const byScore = [...studentReportRows].sort((a, b) => b.scorePercent - a.scorePercent);
    return {
      best: byScore[0],
      worst: byScore[byScore.length - 1],
      total: studentReportRows.length,
      violations: studentReportRows.reduce((sum, row) => sum + row.violationsCount, 0),
    };
  }, [studentReportRows]);

  const sortedDepartmentRows = sortRows(rankedRows, sortState);
  const sortedBatchRows = sortRows(rankedRows, sortState);
  const sortedStudentReportRows = sortRows(studentReportRows, sortState);

  const studentMatches = useMemo(() => {
    if (studentSearchTerm.length < 2) return [];
    return studentSearchResults;
  }, [studentSearchResults, studentSearchTerm]);

  const handleStudentSelect = (nextStudentId) => {
    updateParams({ student_id: nextStudentId || "" });
    setStudentSearch("");
  };

  const handleDepartmentChange = (nextDepartmentId) => {
    setStudentDepartmentId(nextDepartmentId || "");
    updateParams({ student_id: "" });
    setStudentSearch("");
  };

  useEffect(() => {
    setSortState(MODE_DEFAULT_SORT[mode]);
    if (mode !== "student") {
      setStudentSearch("");
      setStudentDepartmentId("");
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
          downloadUrl: status.download_url || prev.downloadUrl || `${apiBasePath}/reports/${jobId}/download`,
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
          year: studentYear || undefined,
        },
      });

      const jobId = result?.jobId;
      if (!jobId) {
        setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
        return;
      }

      setExportState({ status: "polling", progress: 5, downloadUrl: `${apiBasePath}/reports/${jobId}/download`, expiresAt: null, jobId });
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
    setStudentSearch("");
    setStudentDepartmentId("");
  };

  const handleYearChange = (nextYear) => {
    setStudentYear(nextYear || "");
    updateParams({ student_id: "" });
    setStudentSearch("");
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
    setReviewState({ eventKey: "", action: "", reason: "", submitting: false, error: "" });
  };
  const handleViolationReview = async (event, action) => {
    const reason = reviewState.reason.trim();
    if (!event?.testId || !event?.anomalyId || !event?.anomalyType || !reason) {
      setReviewState((prev) => ({ ...prev, error: "A reason is required before submitting a review." }));
      return;
    }
    const eventKey = event.anomalyId;
    setReviewState((prev) => ({ ...prev, eventKey, action, submitting: true, error: "" }));
    try {
      await adminApi.reviewReportAnomaly({
        testId: event.testId,
        anomalyId: event.anomalyId,
        anomalyType: event.anomalyType,
        action,
        reason,
      });
      setViolationDialog((prev) => ({ ...prev, open: false }));
      setReviewState({ eventKey: "", action: "", reason: "", submitting: false, error: "" });
      analyticsQuery.refetch();
    } catch (_error) {
      setReviewState((prev) => ({ ...prev, submitting: false, error: "Unable to save review. Please try again." }));
    }
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
          <label className="space-y-1 text-xs text-text-secondary">
            <span>Student Year</span>
            <select
              value={studentYear}
              onChange={(event) => handleYearChange(event.target.value)}
              className="h-9 min-w-40 rounded-lg border border-border bg-background px-3 text-sm text-text-primary"
            >
              <option value="">All years</option>
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year} YEAR</option>
              ))}
            </select>
          </label>

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
            <div className="grid w-full gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-text-primary">Select student</p>
                  <p className="text-xs text-text-secondary">Choose a student here to load all of their test reports and analytics.</p>
                </div>

                {showStudentDepartmentFilter ? (
                  <div className="mb-3 max-w-xs">
                    <label className="space-y-1 text-xs text-text-secondary">
                      <span>Department</span>
                      <select
                        value={studentDepartmentId}
                        onChange={(event) => handleDepartmentChange(event.target.value)}
                        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                      >
                        <option value="">All departments</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>{department.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    value={studentId}
                    onChange={(event) => handleStudentSelect(event.target.value)}
                    className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                  >
                    <option value="">Choose a student</option>
                    {selectedStudentPickerRecord && !selectedDirectoryStudent ? (
                      <option value={selectedStudentPickerRecord.id}>
                        {selectedStudentPickerRecord.fullName} ({selectedStudentPickerRecord.studentId})
                      </option>
                    ) : null}
                    {studentsDirectory.map((student) => (
                      <option key={student.id} value={student.id}>{student.fullName} ({student.studentId})</option>
                    ))}
                  </select>
                  {studentId ? (
                    <button
                      type="button"
                      onClick={() => {
                        updateParams({ student_id: "" });
                        setStudentSearch("");
                      }}
                      className="h-10 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="relative mt-2">
                  <input
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="Or search by name, roll number, or department"
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  />

                  {studentSearchTerm.length >= 2 ? (
                    <div className="absolute top-11 z-10 max-h-60 w-full overflow-y-auto rounded-2xl border border-border bg-card p-1 shadow-lg">
                      {studentSearchQuery.isLoading ? (
                        <p className="px-3 py-2 text-sm text-text-secondary">Searching students...</p>
                      ) : studentSearchQuery.isError ? (
                        <p className="px-3 py-2 text-sm text-red-500">Unable to search students.</p>
                      ) : studentMatches.length > 0 ? (
                        studentMatches.map((student) => (
                          <button
                            key={student.id}
                            type="button"
                            onClick={() => handleStudentSelect(student.id)}
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                          >
                            <span className="font-medium text-text-primary">{student.fullName}</span>
                            <span className="text-xs text-text-secondary">{student.studentId} · {student.department?.name || "-"} · {student.year || "-"}</span>
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-sm text-text-secondary">No matching students found.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Current selection</p>
                {selectedStudentPickerRecord ? (
                  <div className="mt-3 space-y-1">
                    <p className="font-semibold text-text-primary">{selectedStudentPickerRecord.fullName}</p>
                    <p className="text-sm text-text-secondary">{selectedStudentPickerRecord.studentId}</p>
                    <p className="text-sm text-text-secondary">Year: {selectedStudentPickerRecord.year ? `${selectedStudentPickerRecord.year} YEAR` : "-"}</p>
                    <p className="text-sm text-text-secondary">{selectedStudentPickerRecord.department?.name || "-"} · {selectedStudentPickerRecord.batch?.name || selectedStudentBatchLabel}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-text-secondary">No student selected yet.</p>
                )}
              </div>
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
            <>
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
            </>
          ) : (
            <StudentIdentityCard student={selectedStudent} stats={studentStats} />
          )}

          {mode === "department" ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                <ChartCard title="Monthly Score Trend" height="h-[220px]">
                  <AreaTrendChart data={trendData} xKey="month" dataKey="score" name="Avg Score" color="var(--chart-1)" />
                </ChartCard>
                <ChartCard title="Topic-wise Scores" height="h-[240px]">
                  <TopicPieChart data={topicData} />
                </ChartCard>
              </div>

              <ChartCard title="Department Comparison" height="h-[200px]">
                <div className="h-full p-4 bg-white rounded-md overflow-auto">
                  <GroupedBarChart
                    data={departmentComparative}
                    xKey="department"
                    series={[
                      { key: "avgScore", label: "Avg Score" },
                      { key: "passRate", label: "Pass Rate" },
                      { key: "participationRate", label: "Participation" },
                    ]}
                  />
                </div>
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
                <div className="h-full p-4 bg-white rounded-md overflow-auto">
                  <GroupedBarChart
                    data={batchComparative}
                    xKey="batch"
                    series={[
                      { key: "avgScore", label: "Avg Score" },
                      { key: "passRate", label: "Pass Rate" },
                    ]}
                    highlightCategory={batches.find((item) => item.id === batchId)?.name || ""}
                  />
                </div>
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
                            action={{ label: "Go to Batch Management", onClick: () => navigate(`${basePath}/batches`) }}
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
                <EmptyState title="Select a student" description="Use the student picker above to load that student's complete analytics and test history." />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard label="Best Score Test" value={studentSummary.best?.testName || "-"} sub={studentSummary.best ? formatPercent(studentSummary.best.scorePercent) : "No attempts yet"} />
                    <KpiCard label="Worst Score Test" value={studentSummary.worst?.testName || "-"} sub={studentSummary.worst ? formatPercent(studentSummary.worst.scorePercent) : "No attempts yet"} />
                    <KpiCard label="Tests Attempted" value={studentSummary.total} sub="Submitted attempts" />
                    <KpiCard label="Total Violations" value={studentSummary.violations} sub="Across all attempts" flag={studentSummary.violations > 0} flagLabel="Review recommended" />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
                    <ChartCard title="Score Progression" height="h-[220px]">
                      <AreaTrendChart
                        data={studentReportRows.map((item) => ({ month: formatDateLabel(item.date), score: item.scorePercent })).reverse()}
                        xKey="month"
                        dataKey="score"
                        name="Score"
                        refValue={analytics?.metrics?.avgScore}
                        refLabel="Dept Avg"
                        color="var(--chart-2)"
                      />
                    </ChartCard>

                    <ChartCard title="Topic Strengths" height="h-[240px]">
                      <TopicPieChart data={topicData} />
                    </ChartCard>
                  </div>

                  <ChartCard title="Topic Breakdown" height="h-[180px]">
                    <HorizontalBarChart data={topicData} />
                  </ChartCard>

                  <article className="space-y-3 rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold text-text-primary">All Test Reports</h3>
                        <p className="text-xs text-text-secondary">Complete submitted test history for this student.</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button type="button" onClick={() => handleSort("date")} className="rounded-full border border-border px-3 py-1">Newest</button>
                        <button type="button" onClick={() => handleSort("scorePercent")} className="rounded-full border border-border px-3 py-1">Score</button>
                        <button type="button" onClick={() => handleSort("timeTaken")} className="rounded-full border border-border px-3 py-1">Time</button>
                      </div>
                    </div>
                    {studentDetailQuery.isLoading ? (
                      <div className="rounded-2xl border border-border bg-background p-4 text-sm text-text-secondary">Loading all student test reports...</div>
                    ) : null}
                    {sortedStudentReportRows.map((row) => (
                      <div
                        key={row.id}
                        className={`rounded-2xl border bg-background p-4 ${
                          row.scorePercent >= 40 ? "border-green-500/20" : "border-red-500/20"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-text-primary">{row.testName}</p>
                            <p className="text-xs text-text-secondary">{formatDateLabel(row.date)}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <ScoreBadge score={row.scorePercent} />
                            <StatusBadge label={row.scorePercent >= 40 ? "PASS" : "FAIL"} variant={row.scorePercent >= 40 ? "success" : "danger"} />
                            <StatusBadge label={row.status} variant={getStatusVariant(row.status)} />
                          </div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={row.scorePercent >= 40 ? "h-full bg-green-500" : "h-full bg-red-500"}
                            style={{ width: `${clampPercent(row.scorePercent)}%` }}
                          />
                        </div>
                        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <StatusBadge label={`Percentile: ${row.percentile != null ? `${row.percentile.toFixed(1)}%` : "-"}`} variant="info" />
                          <StatusBadge label={`Time: ${Number.isFinite(row.timeTaken) ? `${Math.round(row.timeTaken / 60)} min` : "-"}`} variant="default" />
                          <StatusBadge label={`Questions: ${row.questionAnalysis?.correct || 0}/${row.questionAnalysis?.total || 0}`} variant="default" />
                          <div className="flex items-center gap-2">
                            <ViolationBadge count={row.violationsCount} />
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleViolationClick({ studentName: selectedStudent?.name, violationEvents: row.violationEvents })}
                            className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                          >
                            Violation Details
                          </button>
                        </div>
                      </div>
                    ))}
                    {!studentDetailQuery.isLoading && sortedStudentReportRows.length === 0 ? (
                      <EmptyState title="No tests attempted yet." description="Once this student submits tests, every report will appear here." />
                    ) : null}
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
          {showNotAttendedCard ? (
            <AbsentStudentsCard
              title={notAttended.testName ? `Not Attended: ${notAttended.testName}` : "Not Attended Students"}
              subtitle="Students who did not submit the selected test."
              students={notAttendedStudents}
              count={notAttended.count}
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
              {violationDialog.events.map((event, index) => {
                const eventKey = event.anomalyId || event.id || `${event.submissionId || "submission"}-${index}`;
                const isCurrentReview = reviewState.eventKey === eventKey;
                const reviewable = Boolean(event.testId && event.anomalyId && event.anomalyType);
                const isSubmittingReview = isCurrentReview && reviewState.submitting;
                return (
                <div key={eventKey} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold capitalize text-text-primary">{formatViolationType(event.type || event.anomalyType)}</p>
                    <p className="text-xs text-text-secondary">{formatDateLabel(event.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">Test: {event.testName || "-"}</p>
                  {event.metadata ? (
                    <pre className="mt-2 overflow-x-auto rounded-lg border border-border/70 bg-card p-2 text-[11px] text-text-secondary">{JSON.stringify(event.metadata, null, 2)}</pre>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {reviewable ? (
                      <>
                        <textarea
                          value={isCurrentReview ? reviewState.reason : ""}
                          onChange={(changeEvent) =>
                            setReviewState({
                              eventKey,
                              action: "",
                              reason: changeEvent.target.value,
                              submitting: false,
                              error: "",
                            })
                          }
                          placeholder="Review reason"
                          className="min-h-18 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary"
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            disabled={isSubmittingReview}
                            onClick={() => handleViolationReview(event, "DISMISS")}
                            className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            disabled={isSubmittingReview}
                            onClick={() => handleViolationReview(event, "ESCALATE")}
                            className="rounded-full bg-danger px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                          >
                            Escalate
                          </button>
                        </div>
                      </>
                    ) : null}
                    {isCurrentReview && reviewState.error ? (
                      <p className="text-xs text-red-500">{reviewState.error}</p>
                    ) : null}
                  </div>
                </div>
                );
              })}
            </div>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}




