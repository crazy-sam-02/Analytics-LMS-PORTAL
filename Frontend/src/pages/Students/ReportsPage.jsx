import { Suspense, lazy, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileX, Rocket } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { studentApi } from "@/services/studentApi";
import { reportsQueryOptions, upcomingTestsQueryOptions } from "@/services/studentQueries";

const ReportsLineChart = lazy(() =>
  import("@/components/Students/reports-charts/ReportsLineChart").then((module) => ({ default: module.ReportsLineChart }))
);
const ReportsRadarChart = lazy(() =>
  import("@/components/Students/reports-charts/ReportsRadarChart").then((module) => ({ default: module.ReportsRadarChart }))
);
const ReportsBarChart = lazy(() =>
  import("@/components/Students/reports-charts/ReportsBarChart").then((module) => ({ default: module.ReportsBarChart }))
);

const ALL_TESTS_VALUE = "__all_tests__";

const toNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNum(value, 0)));

const formatMarksPair = (obtained, total) => {
  const obtainedNum = Number(obtained);
  const totalNum = Number(total);
  if (!Number.isFinite(obtainedNum) || !Number.isFinite(totalNum) || totalNum <= 0) {
    return "--";
  }
  return `${obtainedNum}/${totalNum}`;
};

const formatDuration = (secondsInput) => {
  const totalSeconds = Math.max(0, Math.round(toNum(secondsInput, 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
};

const parseFiltersFromSearch = (searchParams) => {
  return {
    test_id: searchParams.get("test_id") || "",
  };
};

const isCompletedStatus = (value) => ["COMPLETED", "COMPLETE"].includes(String(value || "").trim().toUpperCase());

const shouldRevealCorrectAnswers = (reviewMode, deadline, testStatus, completedFlag, canReviewFlag) => {
  if (canReviewFlag || completedFlag || isCompletedStatus(testStatus)) {
    return true;
  }

  const normalized = String(reviewMode || "show_all").toLowerCase();
  if (normalized === "show_all") {
    return true;
  }
  if (normalized === "show_score_only") {
    return false;
  }
  if (normalized === "show_after_deadline") {
    if (!deadline) {
      return false;
    }

    const deadlineMs = new Date(deadline).getTime();
    return Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : false;
  }

  return false;
};

export default function ReportsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [testFilterOpen, setTestFilterOpen] = useState(false);
  const filters = parseFiltersFromSearch(searchParams);
  const hasSelectedTest = Boolean(filters.test_id);
  const shouldFetchReports = true;
  const reportQueryFilters = hasSelectedTest ? { view: "by_test", test_id: filters.test_id } : { view: "overall" };

  const updateFilter = (patch) => {
    const merged = {
      ...filters,
      ...patch,
    };

    const next = new URLSearchParams();
    Object.entries(merged).forEach(([key, value]) => {
      if (value) {
        next.set(key, value);
      }
    });

    setSearchParams(next, { replace: true });
  };

  const reportsQuery = useQuery({
    ...reportsQueryOptions(reportQueryFilters),
    enabled: shouldFetchReports,
  });

  const reportsCatalogQuery = useQuery({
    ...reportsQueryOptions({
      view: "overall",
    }),
    enabled: true,
  });

  const upcomingTestsQuery = useQuery(upcomingTestsQueryOptions());

  const exportMutation = useMutation({
    mutationFn: async () => {
      let lastError = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await studentApi.exportReportsPdf(reportQueryFilters);
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError;
    },
    onSuccess: (payload) => {
      const signedUrl = payload?.signed_url || payload?.signedUrl || payload?.url;
      if (!signedUrl) {
        toast.error("Export completed but file URL was not returned.");
        return;
      }

      const opened = window.open(signedUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = signedUrl;
        link.download = payload?.filename || "student-report.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      if (typeof payload?.revoke === "function") {
        window.setTimeout(() => payload.revoke(), 60_000);
      }
      toast.success("Report export is ready.");
    },
    onError: (error) => {
      toast.error(error?.message || "Unable to export report. Please retry.");
    },
  });

  const raw = reportsQuery.data || {};
  const overall = raw?.overall || {};
  const byTest = raw?.by_test || raw?.byTest || {};

  const summary = overall?.summary || {
    tests_taken: overall?.tests_taken ?? overall?.totalTests,
    avg_score: clampPercent(overall?.avg_score ?? overall?.accuracy),
    best_score: clampPercent(overall?.best_score),
    missed_tests: overall?.missed_tests,
  };

  const lineData =
    overall?.line_chart ||
    overall?.score_trend ||
    raw?.charts?.lineChart ||
    raw?.testWise ||
    raw?.test_wise ||
    [];
  const topicData = overall?.topic_performance || overall?.topic_wise || raw?.charts?.radarChart || [];

  const byTestSummary = {
    totalMarks: byTest?.total_marks ?? byTest?.totalMarks,
    obtainedMarks: byTest?.obtained_marks ?? byTest?.obtainedMarks,
    percentage: byTest?.percentage != null ? clampPercent(byTest.percentage) : byTest?.percentage,
    percentile: byTest?.percentile,
    totalTime: byTest?.time_analytics?.total_time ?? byTest?.timeAnalytics?.totalTime,
    avgTimePerQuestion:
      byTest?.time_analytics?.avg_time_per_question ?? byTest?.timeAnalytics?.avgTimePerQuestion,
  };

  const reviewMode = byTest?.review_mode || raw?.review_mode || "show_all";
  const deadline = byTest?.test?.end_date || byTest?.test?.endDate || raw?.test?.end_date || raw?.test?.endDate;
  const testStatus =
    byTest?.test?.status ||
    byTest?.test?.test_status ||
    byTest?.testStatus ||
    byTest?.test_status ||
    raw?.test?.status ||
    raw?.test?.test_status ||
    raw?.testStatus ||
    raw?.test_status;
  const testCompleted = Boolean(
    byTest?.is_test_completed ||
      byTest?.isTestCompleted ||
      byTest?.test?.is_completed ||
      byTest?.test?.isCompleted ||
      raw?.is_test_completed ||
      raw?.isTestCompleted
  );
  const canReviewFlag = Boolean(byTest?.can_review_answers || byTest?.canReviewAnswers || raw?.can_review_answers || raw?.canReviewAnswers);
  const canShowCorrectAnswers = shouldRevealCorrectAnswers(reviewMode, deadline, testStatus, testCompleted, canReviewFlag);
  const questionRows = byTest?.questions || byTest?.question_breakdown || [];

  const showBarFallback = Array.isArray(topicData) && topicData.length > 0 && topicData.length < 3;

  const map = new Map();
  const addOption = (testId, testName) => {
    const normalizedId = String(testId || "").trim();
    const normalizedName = String(testName || "").trim();
    if (!normalizedId || !normalizedName || map.has(normalizedId)) {
      return;
    }
    map.set(normalizedId, normalizedName);
  };

  const catalogRows = reportsCatalogQuery.data?.testWise || reportsCatalogQuery.data?.test_wise || [];
  catalogRows.forEach((row) => {
    addOption(row?.testId || row?.test_id, row?.testName || row?.test_name || row?.title);
  });

  const liveRows = raw?.testWise || raw?.test_wise || [];
  liveRows.forEach((row) => {
    addOption(row?.testId || row?.test_id, row?.testName || row?.test_name || row?.title);
  });

  const upcomingRows = upcomingTestsQuery.data?.items || [];
  upcomingRows.forEach((item) => {
    addOption(item?.id || item?.test_id || item?.testId, item?.title || item?.name);
  });

  const selectedTestMeta = byTest?.test || raw?.test || null;
  addOption(selectedTestMeta?.id || selectedTestMeta?.test_id, selectedTestMeta?.title || selectedTestMeta?.name);

  const reportTestOptions = Array.from(map.entries()).map(([id, name]) => ({ id, name }));

  const selectedTestName = !filters.test_id
    ? ""
    : reportTestOptions.find((item) => item.id === filters.test_id)?.name ||
      byTest?.test?.title ||
      byTest?.test?.name ||
      raw?.test?.title ||
      raw?.test?.name ||
      "Selected Test";

  const selectedAttemptId =
    byTest?.attempt_id ||
    byTest?.attemptId ||
    byTest?.submission_id ||
    byTest?.submissionId ||
    liveRows.find((row) => String(row?.testId || row?.test_id || "") === String(filters.test_id || ""))?.submissionId ||
    liveRows.find((row) => String(row?.testId || row?.test_id || "") === String(filters.test_id || ""))?.submission_id ||
    null;

  const reportCards = [
    { label: "Tests Taken", value: summary?.tests_taken ?? "--" },
    { label: "Avg Score", value: summary?.avg_score != null ? `${clampPercent(summary.avg_score)}%` : "--" },
    {
      label: "Best Result",
      value:
        summary?.best_score_percent != null || summary?.best_score != null
          ? `${clampPercent(summary?.best_score_percent ?? summary?.best_score)}%${
              Number(summary?.best_score_total_marks || 0) > 0
                ? ` (${formatMarksPair(summary?.best_score_obtained_marks, summary?.best_score_total_marks)})`
                : ""
            }`
          : "--",
    },
    { label: "Missed Tests", value: summary?.missed_tests ?? "--" },
  ];

  return (
    <section className="space-y-5">
      <Card className="rounded-2xl border border-primary/25 bg-linear-to-br from-primary-dark via-primary to-primary-dark p-6 text-primary-foreground shadow-lg shadow-primary/30">
              <div className="flex items-center gap-2 text-primary-foreground/90">
                <Rocket className="size-4" />
                <p className="text-xs font-semibold tracking-[0.12em] uppercase">Report Window</p>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Visualize Your Performance</h1>
              <p className="mt-2 text-sm text-primary-foreground/90">keep track on report of your test performance</p>
            </Card>
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-semibold text-text-primary">Select the test</div>
          <Select
            open={testFilterOpen}
            onOpenChange={setTestFilterOpen}
            value={filters.test_id || ALL_TESTS_VALUE}
            onValueChange={(value) => {
              updateFilter({ test_id: value === ALL_TESTS_VALUE ? "" : value });
              setTestFilterOpen(false);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Filter by test" />
            </SelectTrigger>
            {testFilterOpen ? (
              <SelectContent>
                <SelectItem value={ALL_TESTS_VALUE}>All tests</SelectItem>
                {reportTestOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            ) : null}
          </Select>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending || !shouldFetchReports}>
            <Download className="mr-2 size-4" />
            {exportMutation.isPending ? "Generating PDF..." : "Export PDF"}
          </Button>
        </div>
      </Card>

      {shouldFetchReports && reportsQuery.isLoading ? (
        <div className="grid min-h-[40vh] place-items-center text-text-secondary">Loading reports...</div>
      ) : null}

      {shouldFetchReports && reportsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load report</AlertTitle>
          <AlertDescription>{reportsQuery.error?.message || "Please refresh and try again."}</AlertDescription>
        </Alert>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.isError && shouldFetchReports && !hasSelectedTest ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {reportCards.map((item) => (
              <Card key={item.label} className="p-5">
                <p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">{item.label}</p>
                <p className="mt-2 text-2xl font-bold text-text-primary">{item.value}</p>
              </Card>
            ))}
          </div>

          <Suspense fallback={<div className="rounded-xl border border-border bg-card p-5 text-text-secondary">Loading chart...</div>}>
            <ReportsLineChart data={lineData} />
          </Suspense>

          <Suspense fallback={<div className="rounded-xl border border-border bg-card p-5 text-text-secondary">Loading chart...</div>}>
            {showBarFallback ? <ReportsBarChart data={topicData} /> : <ReportsRadarChart data={topicData} />}
          </Suspense>
        </>
      ) : null}

      {!reportsQuery.isLoading && !reportsQuery.isError && hasSelectedTest && shouldFetchReports ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Selected Test</p>
                <p className="mt-2 text-lg font-semibold text-text-primary">{selectedTestName}</p>
              </div>
              <Button type="button" variant="outline" disabled={!selectedAttemptId} onClick={() => navigate(`/results/${selectedAttemptId}`)}>
                View All Answers & Scores
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5"><p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Total Marks</p><p className="mt-2 text-2xl font-bold text-text-primary">{byTestSummary.totalMarks ?? "--"}</p></Card>
            <Card className="p-5"><p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Obtained Marks</p><p className="mt-2 text-2xl font-bold text-text-primary">{formatMarksPair(byTestSummary.obtainedMarks, byTestSummary.totalMarks)}</p></Card>
            <Card className="p-5"><p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Percentage</p><p className="mt-2 text-2xl font-bold text-text-primary">{byTestSummary.percentage != null ? `${clampPercent(byTestSummary.percentage)}%` : "--"}</p></Card>
            <Card className="p-5"><p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Percentile</p><p className="mt-2 text-2xl font-bold text-text-primary">{byTestSummary.percentile != null ? `${toNum(byTestSummary.percentile)}%` : "--"}</p></Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Total Time</p>
              <p className="mt-2 text-xl font-semibold text-text-primary">
                {byTestSummary.totalTime != null ? formatDuration(byTestSummary.totalTime) : "--"}
              </p>
            </Card>
            <Card className="p-5">
              <p className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Avg Time / Question</p>
              <p className="mt-2 text-xl font-semibold text-text-primary">
                {byTestSummary.avgTimePerQuestion != null ? formatDuration(byTestSummary.avgTimePerQuestion) : "--"}
              </p>
            </Card>
          </div>

          {!canShowCorrectAnswers ? (
            <Alert className="border-warning/30 bg-warning/10 text-warning">
              <AlertTitle>Answer key restricted</AlertTitle>
              <AlertDescription>Correct answers are hidden due to this test's review mode.</AlertDescription>
            </Alert>
          ) : null}

          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-lg font-semibold text-text-primary">Question-level Report</h3>
            </div>

            {Array.isArray(questionRows) && questionRows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Student Answer</TableHead>
                    <TableHead>Correct Answer</TableHead>
                    <TableHead>Marks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {questionRows.map((row, index) => (
                    <TableRow key={row?.id || row?.question_id || index}>
                      <TableCell>{row?.topic || "-"}</TableCell>
                      <TableCell>{row?.type || "-"}</TableCell>
                      <TableCell>{String(row?.student_answer ?? row?.studentAnswer ?? "Not answered")}</TableCell>
                      <TableCell>{canShowCorrectAnswers ? String(row?.correct_answer ?? row?.correctAnswer ?? "-") : "Hidden"}</TableCell>
                      <TableCell>
                        {row?.marks == null && row?.obtained_marks == null
                          ? "-"
                          : Number(row?.total_marks || 0) > 0
                            ? `${row?.marks ?? row?.obtained_marks ?? 0}/${row?.total_marks}`
                            : String(row?.marks ?? row?.obtained_marks ?? "-")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6">
                <Empty className="border border-border">
                  <EmptyMedia variant="icon">
                    <FileX className="size-4" />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>No by-test data</EmptyTitle>
                    <EmptyDescription>Choose a test filter to load a detailed report.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
          </Card>
        </>
      ) : null}

      
    </section>
  );
}
