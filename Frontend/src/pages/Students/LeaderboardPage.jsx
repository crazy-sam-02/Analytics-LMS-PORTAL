import { useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Crown, Medal, Rocket, Trophy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { leaderboardQueryOptions, reportsQueryOptions, upcomingTestsQueryOptions } from "@/services/studentQueries";

const ALL_TESTS_VALUE = "__all_tests__";

const maskStudentName = (fullName = "Student") => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "Student";
  }

  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";
  return lastName ? `${firstName} ${lastName[0].toUpperCase()}.` : firstName;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const clampPercent = (value) => Math.max(0, Math.min(100, toNumber(value, 0)));

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const buildIdentitySet = (values = []) => {
  const normalized = values.map((value) => normalizeText(value)).filter(Boolean);
  return new Set(normalized);
};

const isBetterAttempt = (candidate, current) => {
  if (!current) return true;
  if (candidate.score !== current.score) return candidate.score > current.score;
  if (candidate.timeTakenSeconds !== current.timeTakenSeconds) return candidate.timeTakenSeconds < current.timeTakenSeconds;
  return normalizeText(candidate.fullName) < normalizeText(current.fullName);
};

const normalizeRows = (payload) => {
  const source = payload?.data || payload?.rows || payload?.items || [];

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map((row, index) => ({
    id: row?.id || row?.entry_id || `${row?.studentId || row?.student_id || "student"}-${index + 1}`,
    rank: toNumber(row?.rank, 0),
    testId: row?.testId || row?.test_id || null,
    studentId: row?.studentId || row?.student_id || row?.userId || row?.user_id || null,
    fullName: row?.studentName || row?.student_name || row?.name || "Student",
    score: clampPercent(row?.score),
    percentage: clampPercent(row?.percentage ?? row?.accuracy ?? row?.score),
    department: row?.department || row?.departmentName || "-",
    testName: row?.testName || row?.test_name || "-",
    timeTakenSeconds: toNumber(row?.timeTakenSeconds || row?.time_taken || 0),
  }));
};

const assignCompetitionRank = (rows) => {
  if (!rows.length) {
    return [];
  }

  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.timeTakenSeconds - b.timeTakenSeconds;
  });

  let lastScore = null;
  let lastRank = 0;

  return sorted.map((row, index) => {
    if (lastScore === null || row.score !== lastScore) {
      lastRank = index + 1;
      lastScore = row.score;
    }

    return {
      ...row,
      rank: lastRank,
    };
  });
};

const dedupeByStudent = (rows) => {
  const bestByStudent = new Map();

  rows.forEach((row, index) => {
    const key = String(row.studentId || `unknown-${normalizeText(row.fullName)}-${index + 1}`);
    const current = bestByStudent.get(key);
    if (isBetterAttempt(row, current)) {
      bestByStudent.set(key, row);
    }
  });

  return Array.from(bestByStudent.values());
};

const sortRows = (rows, sortBy) => {
  const sorted = [...rows];

  sorted.sort((a, b) => {
    if (sortBy === "score") {
      if (b.score !== a.score) return b.score - a.score;
      if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
      return normalizeText(a.fullName).localeCompare(normalizeText(b.fullName));
    }

    if (sortBy === "time") {
      if (a.timeTakenSeconds !== b.timeTakenSeconds) return a.timeTakenSeconds - b.timeTakenSeconds;
      if (b.score !== a.score) return b.score - a.score;
      return normalizeText(a.fullName).localeCompare(normalizeText(b.fullName));
    }

    if (a.rank !== b.rank) return a.rank - b.rank;
    return normalizeText(a.fullName).localeCompare(normalizeText(b.fullName));
  });

  return sorted;
};

export default function LeaderboardPage() {
  const user = useSelector((state) => state.auth.user);
  const [filters, setFilters] = useState({
    view: "overall",
    test_id: "",
    department: user?.departmentId || user?.department?.id || "",
  });
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState("rank");
  const [focusMyPosition, setFocusMyPosition] = useState(false);

  const requiresTestSelection = filters.view === "per_test";
  const hasSelectedTest = Boolean(filters.test_id);
  const shouldFetchLeaderboard = !requiresTestSelection || hasSelectedTest;

  const leaderboardQuery = useQuery({
    ...leaderboardQueryOptions(filters),
    enabled: shouldFetchLeaderboard,
  });
  const upcomingTestsQuery = useQuery(upcomingTestsQueryOptions());
  const reportsCatalogQuery = useQuery({
    ...reportsQueryOptions({ view: "overall" }),
    enabled: true,
  });
  const parentRef = useRef(null);

  const rankedRows = useMemo(() => {
    const normalizedRows = normalizeRows(leaderboardQuery.data);
    const dedupedRows = dedupeByStudent(normalizedRows);
    return assignCompetitionRank(dedupedRows);
  }, [leaderboardQuery.data]);

  const searchedRows = useMemo(() => {
    const query = normalizeText(searchText);
    if (!query) {
      return rankedRows;
    }

    return rankedRows.filter((row) => {
      const name = normalizeText(row.fullName);
      const studentId = normalizeText(row.studentId);
      return name.includes(query) || studentId.includes(query);
    });
  }, [rankedRows, searchText]);

  const sortedRows = useMemo(() => sortRows(searchedRows, sortBy), [searchedRows, sortBy]);

  const currentStudentIdentity = useMemo(
    () =>
      buildIdentitySet([
        user?.studentId,
        user?.rollNumber,
        user?.id,
        user?._id,
        user?.userId,
        user?.student?.studentId,
        user?.student?.id,
      ]),
    [user],
  );
  const currentStudentName = normalizeText(user?.fullName || user?.name);

  const isCurrentStudentRow = (row) => {
    const rowIdentity = buildIdentitySet([row?.studentId, row?.userId, row?.id]);
    const hasIdentityMatch = Array.from(rowIdentity).some((id) => currentStudentIdentity.has(id));

    if (hasIdentityMatch) {
      return true;
    }

    if (rowIdentity.size === 0 && currentStudentName) {
      return normalizeText(row?.fullName) === currentStudentName;
    }

    return false;
  };

  const currentStudentIndex = sortedRows.findIndex((row) => isCurrentStudentRow(row));
  const currentStudentRow = currentStudentIndex >= 0 ? sortedRows[currentStudentIndex] : null;

  const shouldLimitToTopHundred = !focusMyPosition && !normalizeText(searchText) && sortBy === "rank";
  const topHundred = shouldLimitToTopHundred ? sortedRows.slice(0, 100) : sortedRows;
  const shouldPinCurrentAtBottom = shouldLimitToTopHundred && currentStudentIndex >= 100;

  const nearbyRows = useMemo(() => {
    if (!focusMyPosition || !currentStudentRow) {
      return topHundred;
    }

    const start = Math.max(0, currentStudentIndex - 3);
    const end = Math.min(sortedRows.length, currentStudentIndex + 4);
    return sortedRows.slice(start, end);
  }, [currentStudentIndex, currentStudentRow, focusMyPosition, sortedRows, topHundred]);

  const displayRows = useMemo(() => {
    const rows = nearbyRows.map((row) => ({ kind: "row", ...row }));

    if (shouldPinCurrentAtBottom && currentStudentRow && !focusMyPosition) {
      rows.push({ kind: "separator", id: "__current_sep__" });
      rows.push({ kind: "row", ...currentStudentRow, pinned: true });
    }

    return rows;
  }, [currentStudentRow, focusMyPosition, nearbyRows, shouldPinCurrentAtBottom]);

  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (displayRows[index]?.kind === "separator" ? 40 : 54),
    overscan: 10,
  });

  const showNotAttempted = filters.view === "per_test" && Boolean(filters.test_id) && shouldFetchLeaderboard && !currentStudentRow;

  const testOptionsMap = new Map();
  const addTestOption = (testId, testName) => {
    const normalizedId = String(testId || "").trim();
    const normalizedName = String(testName || "").trim();
    if (!normalizedId || !normalizedName || testOptionsMap.has(normalizedId)) {
      return;
    }
    testOptionsMap.set(normalizedId, normalizedName);
  };

  const upcomingTests = upcomingTestsQuery.data?.items || [];
  upcomingTests.forEach((item) => {
    addTestOption(item?.id || item?.test_id || item?.testId, item?.title || item?.name);
  });

  const completedTests = reportsCatalogQuery.data?.testWise || reportsCatalogQuery.data?.test_wise || [];
  completedTests.forEach((row) => {
    addTestOption(row?.testId || row?.test_id, row?.testName || row?.test_name || row?.title);
  });

  sortedRows.forEach((row) => {
    addTestOption(row?.testId, row?.testName);
  });

  const testOptions = Array.from(testOptionsMap.entries()).map(([id, name]) => ({ id, name }));
  const selectedTestName = testOptions.find((item) => item.id === filters.test_id)?.name || "Selected Test";
  const currentStudentDisplayIndex = displayRows.findIndex((row) => row?.kind === "row" && isCurrentStudentRow(row));

  const formatPercentage = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "-";
    return `${num.toFixed(1)}%`;
  };

  return (
    <section className="space-y-5">
      <Card className="rounded-2xl border border-primary/25 bg-linear-to-br from-primary-dark via-primary to-primary-dark p-6 text-primary-foreground shadow-lg shadow-primary/30">
              <div className="flex items-center gap-2 text-primary-foreground/90">
                <Rocket className="size-4" />
                <p className="text-xs font-semibold tracking-[0.12em] uppercase">Track Window</p>
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Track Your Status</h1>
              <p className="mt-2 text-sm text-primary-foreground/90">Track Your Status Among your Friend on the Test You Participated</p>
            </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex items-center gap-3 p-5">
          <div className="grid size-10 place-items-center rounded-xl bg-yellow-100 text-yellow-600"><Crown className="size-5" /></div>
          <div className="flex flex-col items-center">
            <p className="text-xs tracking-wide text-text-secondary uppercase">Top Rank</p>
            <p className="text-lg font-semibold text-text-primary">#{topHundred[0]?.rank || "-"}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-5">
          <div className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><Trophy className="size-5" /></div>
          <div className="flex flex-col items-center">
            <p className="text-xs tracking-wide text-text-secondary uppercase">Highest Score</p>
            <p className="text-lg font-semibold text-text-primary">{topHundred[0]?.score ?? "-"}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-5">
          <div className="grid size-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700"><Medal className="size-5" /></div>
          <div className="flex flex-col items-center">
            <p className="text-xs tracking-wide text-text-secondary uppercase">Visible Entries</p>
            <p className="text-lg font-semibold text-text-primary">{displayRows.filter((row) => row.kind === "row").length}</p>
          </div>
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <Tabs value={filters.view} onValueChange={(value) => setFilters((prev) => ({ ...prev, view: value }))}>
          <TabsList>
            <TabsTrigger value="overall">Overall</TabsTrigger>
            <TabsTrigger value="per_test">Per Test</TabsTrigger>
            <TabsTrigger value="department_wise">Department-wise</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-3 md:grid-cols-2">
          <Select
            value={filters.test_id || ALL_TESTS_VALUE}
            onValueChange={(value) => setFilters((prev) => ({ ...prev, test_id: value === ALL_TESTS_VALUE ? "" : value }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select test (for Per Test view)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TESTS_VALUE}>All tests</SelectItem>
              {testOptions.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Search by student name or ID"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Sort rows" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rank">Sort by Rank</SelectItem>
              <SelectItem value="score">Sort by Score</SelectItem>
              <SelectItem value="time">Sort by Time Taken</SelectItem>
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={() => setFocusMyPosition((prev) => !prev)}
            className="h-10 rounded-md border border-border px-3 text-sm font-medium text-text-secondary"
            disabled={!currentStudentRow}
          >
            {focusMyPosition ? "Show Full List" : "Focus My Position"}
          </button>

          <button
            type="button"
            onClick={() => {
              if (currentStudentDisplayIndex >= 0) {
                rowVirtualizer.scrollToIndex(currentStudentDisplayIndex, { align: "center" });
              }
            }}
            className="h-10 rounded-md border border-border px-3 text-sm font-medium text-text-secondary"
            disabled={currentStudentDisplayIndex < 0}
          >
            Jump To Me
          </button>
        </div>

        {requiresTestSelection && !hasSelectedTest ? (
          <p className="text-sm text-text-secondary">Choose a test from the dropdown to load per-test rankings.</p>
        ) : null}

        {requiresTestSelection && hasSelectedTest ? (
          <p className="text-sm text-text-secondary">
            Viewing leaderboard for <span className="font-semibold text-text-primary">{selectedTestName}</span>
          </p>
        ) : null}
      </Card>

      {showNotAttempted ? (
        <Alert className="border-warning/30 bg-warning/10 text-warning">
          <AlertTitle>Per test status</AlertTitle>
          <AlertDescription>You did not attempt this test.</AlertDescription>
        </Alert>
      ) : null}

      {shouldFetchLeaderboard && leaderboardQuery.isLoading ? (
        <div className="grid min-h-[40vh] place-items-center text-text-secondary">Loading leaderboard...</div>
      ) : null}

      {shouldFetchLeaderboard && leaderboardQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Failed to load leaderboard</AlertTitle>
          <AlertDescription>{leaderboardQuery.error?.message || "Please retry shortly."}</AlertDescription>
        </Alert>
      ) : null}

      {!leaderboardQuery.isLoading && !leaderboardQuery.isError && shouldFetchLeaderboard && displayRows.length === 0 ? (
        <Card className="p-6">
          <Empty className="border border-border">
            <EmptyHeader>
              <EmptyTitle>{normalizeText(searchText) ? "No matching students" : "No rankings yet"}</EmptyTitle>
              <EmptyDescription>
                {normalizeText(searchText)
                  ? "Try a shorter search or clear filters to see more results."
                  : "Once students submit tests, this leaderboard will populate."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : null}

      {!leaderboardQuery.isLoading && !leaderboardQuery.isError && shouldFetchLeaderboard && displayRows.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <div className="grid w-max min-w-full grid-cols-[88px_1.4fr_1fr_110px_120px] gap-3 border-b border-border bg-background px-4 py-3 text-xs font-semibold tracking-wide text-text-secondary uppercase">
            <p>Rank</p>
            <p>Student</p>
            <p>Department</p>
            <p>Score</p>
            <p>Percentage</p>
          </div>

          <div ref={parentRef} className="h-96 overflow-auto lg:h-140">
            <div className="min-w-max" style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = displayRows[virtualRow.index];

                if (row?.kind === "separator") {
                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 top-0 flex w-full items-center justify-center px-4 text-xs font-medium tracking-wide text-text-secondary uppercase"
                      style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                    >
                      Your Position
                    </div>
                  );
                }

                const isCurrent = isCurrentStudentRow(row);

                return (
                  <div
                    key={`${row.id}-${row.rank}`}
                    className={`absolute left-0 top-0 grid w-full grid-cols-[88px_1.4fr_1fr_110px_120px] gap-3 border-b border-border px-4 py-3 text-sm ${
                      isCurrent ? "bg-primary/10" : "bg-card"
                    }`}
                    style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <p className="font-semibold text-primary">#{row.rank}</p>
                    <p className="font-medium text-text-primary">{maskStudentName(row.fullName)} {isCurrent ? "(You)" : ""}</p>
                    <p className="text-text-secondary">{row.department}</p>
                    <p className="font-semibold text-text-primary">{row.score}</p>
                    <p className="text-text-secondary">{formatPercentage(row.percentage)}</p>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
        </Card>
      ) : null}

      {!shouldFetchLeaderboard ? (
        <Card className="p-6">
          <Empty className="border border-border">
            <EmptyHeader>
              <EmptyTitle>Select a test</EmptyTitle>
              <EmptyDescription>Per-test leaderboard needs a test selection from the dropdown above.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : null}

      {!currentStudentRow && shouldFetchLeaderboard ? (
        <Card className="p-4 text-sm text-text-secondary">No attempts found for your profile yet. You will appear here after your first submission.</Card>
      ) : null}
    </section>
  );
}
