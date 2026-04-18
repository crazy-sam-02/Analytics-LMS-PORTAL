import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Clock3, PlayCircle, CheckCircle2 } from "lucide-react";
import { activeAttemptsQueryOptions, reportsQueryOptions } from "@/services/studentQueries";
import { studentApi } from "@/services/studentApi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const pickId = (item) => item?.id || item?.test_id || item?.testId;

const computeAnswered = (test, totalQuestions) => {
  if (Number.isFinite(test?.answeredCount)) {
    return Number(test.answeredCount);
  }

  if (Array.isArray(test?.answers)) {
    return test.answers.length;
  }

  if (totalQuestions > 0 && Number.isFinite(test?.progress)) {
    return Math.round((Number(test.progress) / 100) * totalQuestions);
  }

  return 0;
};

const useServerNowRaf = (serverTime) => {
  const [now, setNow] = useState(serverTime || Date.now());
  const frameRef = useRef(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const safeServerTime = serverTime || Date.now();
    offsetRef.current = safeServerTime - Date.now();

    const update = () => {
      setNow(Date.now() + offsetRef.current);
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [serverTime]);

  return now;
};

const formatRemaining = (ms) => {
  if (ms <= 0) {
    return "Auto-submitted";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
};

export default function OngoingTestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [continueTarget, setContinueTarget] = useState(null);
  const backgroundSubmittedRef = useRef(new Set());

  const { data, isLoading, isFetched } = useQuery(activeAttemptsQueryOptions());
  const reportsQuery = useQuery(reportsQueryOptions({ view: "overall" }));
  const now = useServerNowRaf(data?.serverTime);

  const submitMutation = useMutation({
    mutationFn: studentApi.submitAttempt,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["student", "attempts", "active"] });
    },
  });

  const startMutation = useMutation({
    mutationFn: ({ test_id }) => studentApi.startAttempt({ test_id }),
  });

  const attempts = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((test) => {
      const totalQuestions = Number(test?.totalQuestions || test?.questions?.length || 0);
      const answered = computeAnswered(test, totalQuestions);
      const progress = totalQuestions > 0 ? Math.round((answered / totalQuestions) * 100) : Number(test?.progress || 0);
      const endTime = new Date(test?.server_end_time || test?.endsAt || test?.endTime || 0).getTime();
      const remainingMs = endTime - now;
      const id = pickId(test);

      return {
        ...test,
        id,
        totalQuestions,
        answered,
        progress: Number.isFinite(progress) ? progress : 0,
        endTime,
        remainingMs,
        autoSubmitted: remainingMs <= 0,
        canTryAgain: Boolean(test?.canTryAgain),
        isCompleted: Boolean(test?.isCompleted),
        attemptsUsed: Number(test?.attemptsUsed || 0),
        attemptsAllowed: Number(test?.attemptsAllowed || 1),
        attemptsRemaining: Number(test?.attemptsRemaining || 0),
      };
    });
  }, [data, now]);

  const completedTests = useMemo(() => {
    const rows = reportsQuery.data?.testWise || reportsQuery.data?.test_wise || [];
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows.map((row) => ({
      id: row?.submissionId || row?.submission_id || row?.id,
      testId: row?.testId || row?.test_id || null,
      title: row?.testName || row?.test_name || row?.title || "Untitled Test",
      subject: row?.subject || "-",
      score: Number(row?.score || 0),
      accuracy: Number(row?.accuracy || 0),
      submittedAt: row?.submittedAt || row?.submitted_at || null,
      endDate: row?.endDate || row?.end_date || null,
    }));
  }, [reportsQuery.data]);

  useEffect(() => {
    attempts.forEach((attempt) => {
      if (!attempt.autoSubmitted || !attempt?.submissionId || !attempt?.id || attempt.isCompleted || attempt.canTryAgain) {
        return;
      }

      const cacheKey = `${attempt.id}:${attempt.submissionId}`;
      if (backgroundSubmittedRef.current.has(cacheKey)) {
        return;
      }

      backgroundSubmittedRef.current.add(cacheKey);
      submitMutation.mutate({ testId: attempt.id, submissionId: attempt.submissionId });
    });
  }, [attempts, submitMutation]);

  if (!isFetched && isLoading) {
    return <div className="py-8 text-center text-sm text-slate-500">Loading ongoing tests...</div>;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Ongoing Tests</h1>
        <Badge variant="secondary" className="bg-blue-50 text-blue-700">{attempts.length} Active</Badge>
      </div>

      {attempts.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-lg font-semibold text-slate-800">No active tests right now</p>
          <p className="mt-2 text-sm text-slate-500">You are all clear. Come back when a test is active.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {attempts.map((test) => (
            <Card key={test.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-slate-900">{test.title || test.name || "Untitled Test"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      <Clock3 className="size-3.5" />
                      {formatRemaining(test.remainingMs)}
                    </span>
                    {test.autoSubmitted ? (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800">Auto-submitted</Badge>
                    ) : null}
                    {test.isCompleted ? (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Completed</Badge>
                    ) : null}
                    {test.canTryAgain ? (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                        Try Again ({test.attemptsUsed}/{test.attemptsAllowed})
                      </Badge>
                    ) : null}
                  </div>
                </div>

                {!test.autoSubmitted && !test.isCompleted ? (
                  <Button className="h-10 rounded-lg bg-blue-700 hover:bg-blue-800" onClick={() => setContinueTarget(test)} disabled={startMutation.isPending}>
                    <PlayCircle className="mr-2 size-4" />
                    {test.canTryAgain ? "Attend" : "Continue"}
                  </Button>
                ) : (
                  <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                    <CheckCircle2 className="mr-1 size-3.5" />
                    {test.isCompleted ? "Completed" : "Closed"}
                  </Badge>
                )}
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                  <span>{test.answered}/{test.totalQuestions || "-"} answered</span>
                  <span>{test.progress}%</span>
                </div>
                <Progress value={test.progress} className="h-2 bg-slate-200 **:data-[slot=progress-indicator]:bg-blue-700" />
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <h2 className="text-xl font-semibold text-slate-900">Completed Tests</h2>
        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">{completedTests.length} Completed</Badge>
      </div>

      {reportsQuery.isLoading ? (
        <Card className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Loading completed tests...
        </Card>
      ) : null}

      {!reportsQuery.isLoading && completedTests.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-lg font-semibold text-slate-800">No completed tests yet</p>
          <p className="mt-2 text-sm text-slate-500">Once you submit a test, it will appear here with marks and answer review.</p>
        </Card>
      ) : null}

      {!reportsQuery.isLoading && completedTests.length > 0 ? (
        <div className="space-y-4">
          {completedTests.map((test) => (
            (() => {
              const endTime = test.endDate ? new Date(test.endDate).getTime() : Number.NaN;
              const isClosed = Number.isFinite(endTime) ? now >= endTime : true;

              return (
            <Card key={test.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-slate-900">{test.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded-md bg-slate-100 px-2 py-1">Subject: {test.subject}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1">Marks: {test.score}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1">Accuracy: {Number.isFinite(test.accuracy) ? `${test.accuracy}%` : "-"}</span>
                    <span className={`rounded-md px-2 py-1 ${isClosed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                      {isClosed ? "Test Closed" : "Test Not Closed"}
                    </span>
                    {test.endDate ? (
                      <span className="rounded-md bg-slate-100 px-2 py-1">Ends: {new Date(test.endDate).toLocaleString()}</span>
                    ) : null}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/results/${test.id}`)}
                  disabled={!test.id || !isClosed}
                >
                  {isClosed ? "View Answers" : "Available After Test Ends"}
                </Button>
              </div>
            </Card>
              );
            })()
          ))}
        </div>
      ) : null}

      <Dialog open={Boolean(continueTarget)} onOpenChange={(open) => !open && setContinueTarget(null)}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{continueTarget?.canTryAgain ? "Try test again?" : "Continue test?"}</DialogTitle>
            <DialogDescription>
              {continueTarget?.canTryAgain
                ? `You already submitted this test. You have ${continueTarget?.attemptsRemaining || 0} attempt(s) left.`
                : `You are resuming ${continueTarget?.title || continueTarget?.name || "this test"}. Proceed when you are ready.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContinueTarget(null)}>Not now</Button>
            <Button
              onClick={() => {
                const target = continueTarget;
                setContinueTarget(null);
                if (target?.id) {
                  startMutation
                    .mutateAsync({ test_id: target.id })
                    .then((payload) => {
                      const attemptId = payload?.attempt_id || payload?.attemptId || payload?.submission?.id;
                      if (!attemptId) {
                        throw new Error("Attempt id missing");
                      }
                      navigate(`/test/${attemptId}`);
                    })
                    .catch(() => {
                      navigate(`/tests/${target.id}/take`);
                    });
                }
              }}
            >
              {continueTarget?.canTryAgain ? "Try Again" : "Continue Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
