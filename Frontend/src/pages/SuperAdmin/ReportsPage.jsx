import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { superAdminApi } from "@/services/api";
import {
  AreaTrendChart,
  ChartCard,
  EmptyState,
  ExportButton,
  GroupedBarChart,
  KpiCard,
  ScoreBadge,
  Th,
  ViolationBadge,
} from "@/components/Reports/components";
import { formatPercent, toQueryString } from "@/components/Reports/utils";

const SUPER_MODES = [
  { key: "platform", label: "Platform Overview" },
  { key: "college", label: "Per College" },
];

const MODE_DEFAULT_SORT = {
  platform: { key: "avgScore", dir: "desc" },
  college: { key: "avgScore", dir: "desc" },
};

const sortRows = (rows, sortState) => {
  if (!Array.isArray(rows) || !rows.length) return [];
  const { key, dir } = sortState;
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
};

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = SUPER_MODES.some((item) => item.key === searchParams.get("mode")) ? searchParams.get("mode") : "platform";
  const testId = searchParams.get("test") || "all";
  const collegeId = searchParams.get("college") || "";

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
      if (value == null || value === "") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    });
    setSearchParams(nextParams);
  };

  const testsQuery = useQuery({
    queryKey: ["super-reports-tests-v2"],
    queryFn: () => superAdminApi.getTests("?page=1&limit=100"),
    staleTime: 120000,
  });

  const collegesQuery = useQuery({
    queryKey: ["super-reports-colleges-v2"],
    queryFn: () => superAdminApi.getColleges("?page=1&limit=200"),
    staleTime: 120000,
  });

  const studentsQuery = useQuery({
    queryKey: ["super-reports-students-v2"],
    queryFn: () => superAdminApi.getStudents("?page=1&limit=500"),
    staleTime: 120000,
  });

  const analyticsQuery = useQuery({
    queryKey: ["super-reports-analytics-v2"],
    queryFn: () => superAdminApi.getAnalytics(),
    staleTime: 60000,
  });

  const reportsQuery = useQuery({
    queryKey: ["super-reports-jobs-v2"],
    queryFn: () => superAdminApi.getReports(),
    staleTime: 30000,
  });

  const tests = testsQuery.data?.data || [];
  const colleges = collegesQuery.data?.data || [];
  const students = studentsQuery.data?.data || [];
  const analytics = analyticsQuery.data || {};
  const reports = reportsQuery.data || [];

  const collegeRows = useMemo(() => {
    const base = (analytics.collegeComparative || []).map((item) => ({
      collegeId: item.collegeId || item.id,
      collegeName: item.collegeName || item.name || "-",
      students: Number(item.students || item.studentCount || 0),
      avgScore: Number(item.avgScore || 0),
      passRate: Number(item.passRate || 0),
      participation: Number(item.participation || 0),
      violations: Number(item.violations || 0),
      trend: item.trend || [],
      departments: item.departments || [],
    }));

    if (base.length) return base;

    return colleges.map((college) => ({
      collegeId: college.id,
      collegeName: college.name,
      students: 0,
      avgScore: 0,
      passRate: 0,
      participation: 0,
      violations: 0,
      trend: [],
      departments: [],
    }));
  }, [analytics.collegeComparative, colleges]);

  const selectedCollege = collegeRows.find((item) => item.collegeId === collegeId) || null;

  const platformTrend = (analytics.platformTrend || []).map((item, index) => ({
    month: item.month || item.date || `P${index + 1}`,
    score: Number(item.score || item.avgScore || 0),
  }));

  const platformViolations =
    analytics.collegeViolations ||
    collegeRows.map((row) => ({
      college: row.collegeName,
      violations: row.violations,
    }));

  const groupedCollegeData = collegeRows.map((row) => ({
    college: row.collegeName,
    avgScore: row.avgScore,
    passRate: row.passRate,
    participation: row.participation,
    violations: row.violations,
    students: row.students,
  }));

  const selectedCollegeDepartments = (selectedCollege?.departments || []).map((item, index) => ({
    department: item.departmentName || item.department || `Dept ${index + 1}`,
    avgScore: Number(item.avgScore || 0),
    passRate: Number(item.passRate || 0),
    participation: Number(item.participationRate || item.participation || 0),
    violations: Number(item.violations || 0),
  }));

  const sortedPlatformRows = sortRows(groupedCollegeData, sortState);
  const sortedCollegeRows = sortRows(selectedCollegeDepartments, sortState);

  const totalStudents = students.length;
  const totalTests = tests.length;
  const platformAvgScore =
    collegeRows.length > 0 ? collegeRows.reduce((sum, item) => sum + Number(item.avgScore || 0), 0) / collegeRows.length : 0;
  const submissionsThisMonth = Number(
    (analytics.mostActiveTests || []).reduce((sum, item) => sum + Number(item.submissions || 0), 0)
  );

  useEffect(() => {
    setSortState(MODE_DEFAULT_SORT[mode]);
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
        const jobs = await superAdminApi.getReports();
        const job = (jobs || []).find((item) => item.id === jobId);
        if (!job) return;

        const normalized = String(job.status || "").toLowerCase();
        const progress = Number(job?.filters?.progress || 0);

        setExportState((prev) => ({
          ...prev,
          status: normalized === "completed" ? "complete" : normalized === "failed" ? "failed" : "polling",
          progress,
          downloadUrl: job.resultUrl || prev.downloadUrl || `/api/super-admin/reports/${jobId}/download`,
          expiresAt: job?.filters?.resultUrlExpiresAt || prev.expiresAt,
          jobId,
        }));

        if (normalized === "completed" || normalized === "failed") {
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
    const type = mode === "college" ? "DEPARTMENT_WISE" : "TEST_WISE";

    if (mode === "college" && !collegeId) {
      setError("Please select a college to export");
      setTimeout(() => setError(null), 3000);
      return;
    }

    setExportState({ status: "loading", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });

    try {
      const result = await superAdminApi.generateReport({
        type,
        filters: {
          testId: testId === "all" ? undefined : testId,
          collegeId: mode === "college" ? collegeId || undefined : undefined,
        },
      });

      const jobId = result?.id || result?.jobId;
      if (!jobId) {
        setError("Failed to create report job");
        setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
        return;
      }

      setExportState({ status: "polling", progress: 5, downloadUrl: `/api/super-admin/reports/${jobId}/download`, expiresAt: null, jobId });
      startPollingJob(jobId);
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.message || "Failed to generate report";
      setError(errorMsg);
      setExportState({ status: "failed", progress: 0, downloadUrl: "", expiresAt: null, jobId: "" });
    }
  };

  const handleDownload = async () => {
    if (!exportState.jobId) {
      setError("No report available to download");
      return;
    }

    try {
      setError(null);
      const isExpired = exportState.expiresAt && new Date(exportState.expiresAt).getTime() <= Date.now();
      if (isExpired) {
        const refreshed = await superAdminApi.regenerateReportLink(exportState.jobId);
        setExportState((prev) => ({
          ...prev,
          downloadUrl: refreshed.resultUrl || prev.downloadUrl,
          expiresAt: refreshed.expiresAt || prev.expiresAt,
        }));
      }

      const blob = await superAdminApi.downloadReport(exportState.jobId);
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `super-admin-report-${exportState.jobId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.message || "Failed to download report";
      setError(errorMsg);
      setExportState((prev) => ({ ...prev, status: "failed" }));
    }
  };

  const handleSort = (key) => {
    setSortState((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-4 sm:px-6">
      {error && (
        <section className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          ⚠️ {error}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Super Admin Reports</h1>
            <p className="text-sm text-text-secondary">Platform-level visibility and college intelligence.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-text-secondary">Test</label>
            <select value={testId} onChange={(event) => updateParams({ test: event.target.value })} className="h-9 rounded-lg border border-border bg-background px-3 text-sm">
              <option value="all">All Tests</option>
              {tests.map((test) => (
                <option key={test.id} value={test.id}>{test.title}</option>
              ))}
            </select>
            <ExportButton exportState={exportState} onExport={handleExport} onDownload={handleDownload} />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {SUPER_MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => updateParams({ mode: item.key, college: "" })}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                mode === item.key ? "bg-primary text-primary-foreground" : "border border-border bg-background text-text-primary hover:bg-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          {mode === "college" ? (
            <>
              <select
                value={collegeId}
                onChange={(event) => updateParams({ college: event.target.value })}
                className="h-9 min-w-60 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">
                  {collegesQuery.isLoading ? "Loading colleges..." : "Select a college"}
                </option>
                {collegeRows.map((college) => (
                  <option key={college.collegeId} value={college.collegeId}>
                    {college.collegeName} ({college.students} students)
                  </option>
                ))}
              </select>
              {collegeRows.length === 0 && !collegesQuery.isLoading && (
                <div className="text-xs text-text-secondary">No colleges available</div>
              )}
            </>
          ) : null}
        </div>
      </section>

      {analyticsQuery.isLoading || reportsQuery.isLoading ? (
        <section className="rounded-2xl border border-border bg-card p-4 text-sm text-text-secondary">Loading super admin report data...</section>
      ) : null}

      {analyticsQuery.isError ? (
        <section className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-500">
          ⚠️ Unable to load analytics data. Please refresh the page or contact support.
        </section>
      ) : null}

      {!analyticsQuery.isLoading && !analyticsQuery.isError ? (
        <section className="space-y-4">
          {mode === "platform" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="Total Students" value={totalStudents} sub="Registered on platform" />
                <KpiCard label="Total Tests" value={totalTests} sub="Published assessments" />
                <KpiCard label="Platform Avg Score" value={formatPercent(platformAvgScore)} sub="Across all colleges" />
                <KpiCard label="Submissions This Month" value={submissionsThisMonth} sub="Recent test activity" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Platform Score Trend" height="h-[220px]">
                  <AreaTrendChart data={platformTrend} xKey="month" dataKey="score" name="Platform Avg" color="var(--chart-1)" />
                </ChartCard>
                <ChartCard title="Violations by College" height="h-[200px]">
                  <GroupedBarChart
                    data={platformViolations.map((item) => ({ college: item.college || item.collegeName || "-", violations: Number(item.violations || item.count || 0) }))}
                    xKey="college"
                    series={[{ key: "violations", label: "Violations" }]}
                  />
                </ChartCard>
              </div>

              <ChartCard title="College Performance Overview" height="h-[200px]">
                <GroupedBarChart
                  data={groupedCollegeData}
                  xKey="college"
                  series={[
                    { key: "avgScore", label: "Avg Score" },
                    { key: "passRate", label: "Pass Rate" },
                    { key: "participation", label: "Participation" },
                  ]}
                />
              </ChartCard>

              <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th sortKey="college" sortState={sortState} onSort={handleSort}>College</Th>
                      <Th sortKey="students" sortState={sortState} onSort={handleSort}>Students</Th>
                      <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                      <Th sortKey="passRate" sortState={sortState} onSort={handleSort}>Pass Rate</Th>
                      <Th sortKey="participation" sortState={sortState} onSort={handleSort}>Participation</Th>
                      <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlatformRows.map((row) => (
                      <tr key={row.college} className="border-t border-border/70">
                        <td className="px-4 py-3 font-medium text-text-primary">{row.college}</td>
                        <td className="px-4 py-3">{row.students}</td>
                        <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-3">{formatPercent(row.passRate)}</td>
                        <td className="px-4 py-3">{formatPercent(row.participation)}</td>
                        <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>
            </>
          ) : null}

          {mode === "college" ? (
            <>
              {!selectedCollege ? (
                <EmptyState title="Select a college" description="Choose a college to view detailed performance and department-level breakdown." />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard label="Students" value={selectedCollege.students} sub="Active roster" />
                    <KpiCard label="Avg Score" value={formatPercent(selectedCollege.avgScore)} sub="College average" />
                    <KpiCard label="Pass Rate" value={formatPercent(selectedCollege.passRate)} sub="Passing submissions" />
                    <KpiCard label="Violations" value={selectedCollege.violations} sub="Integrity flags" flag={selectedCollege.violations > 10} />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <ChartCard title={`${selectedCollege.collegeName} Score Trend`} height="h-[220px]">
                      <AreaTrendChart
                        data={(selectedCollege.trend || []).map((item, index) => ({ month: item.month || `T${index + 1}`, score: Number(item.score || 0) }))}
                        xKey="month"
                        dataKey="score"
                        name="Avg Score"
                        color="var(--chart-2)"
                      />
                    </ChartCard>

                    <ChartCard title="Department Breakdown" height="h-[200px]">
                      <GroupedBarChart
                        data={selectedCollegeDepartments}
                        xKey="department"
                        series={[
                          { key: "avgScore", label: "Avg Score" },
                          { key: "passRate", label: "Pass Rate" },
                        ]}
                      />
                    </ChartCard>
                  </div>

                  <ChartCard title="Department Performance Detail" height="h-[200px]">
                    <GroupedBarChart
                      data={selectedCollegeDepartments}
                      xKey="department"
                      series={[
                        { key: "avgScore", label: "Avg Score" },
                        { key: "participation", label: "Participation" },
                      ]}
                    />
                  </ChartCard>

                  <article className="overflow-x-auto rounded-2xl border border-border bg-card">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          <Th sortKey="department" sortState={sortState} onSort={handleSort}>Department</Th>
                          <Th sortKey="avgScore" sortState={sortState} onSort={handleSort}>Avg Score</Th>
                          <Th sortKey="passRate" sortState={sortState} onSort={handleSort}>Pass Rate</Th>
                          <Th sortKey="participation" sortState={sortState} onSort={handleSort}>Participation</Th>
                          <Th sortKey="violations" sortState={sortState} onSort={handleSort}>Violations</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedCollegeRows.map((row) => (
                          <tr key={row.department} className="border-t border-border/70">
                            <td className="px-4 py-3 font-medium text-text-primary">{row.department}</td>
                            <td className="px-4 py-3"><ScoreBadge score={row.avgScore} /></td>
                            <td className="px-4 py-3">{formatPercent(row.passRate)}</td>
                            <td className="px-4 py-3">{formatPercent(row.participation)}</td>
                            <td className="px-4 py-3"><ViolationBadge count={row.violations} /></td>
                          </tr>
                        ))}
                        {sortedCollegeRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-8">
                              <EmptyState title="No college breakdown available" description="Department metrics will appear after enough submissions." />
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

          {!analyticsQuery.isLoading && !groupedCollegeData.length ? (
            <EmptyState title="No platform report data" description="No analytics payload is available for the selected scope." />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
