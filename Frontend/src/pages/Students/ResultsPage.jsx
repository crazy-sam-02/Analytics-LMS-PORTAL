import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { attemptResultQueryOptions } from "@/services/studentQueries";

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const formatDuration = (secondsInput) => {
  const seconds = Math.max(0, toNumber(secondsInput));
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
};

const resolveReviewMode = (payload) =>
  String(payload?.review_mode || payload?.reviewMode || payload?.submission?.review_mode || "show_score_only").toLowerCase();

const resolveEndDate = (payload) => {
  const value =
    payload?.test?.end_date ||
    payload?.test?.endDate ||
    payload?.test?.ends_at ||
    payload?.test?.endsAt ||
    payload?.end_date ||
    payload?.endDate;

  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveBreakdown = (payload) => {
  const rows = payload?.question_breakdown || payload?.questionBreakdown || payload?.breakdown || payload?.questions || [];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((item, index) => ({
    id: item?.id || item?.question_id || item?.questionId || `q-${index + 1}`,
    prompt: item?.prompt || item?.question || `Question ${index + 1}`,
    topic: item?.topic || "-",
    studentAnswer: item?.student_answer ?? item?.studentAnswer ?? "Not answered",
    correctAnswer: item?.correct_answer ?? item?.correctAnswer ?? "-",
    marks: toNumber(item?.marks ?? item?.obtained_marks ?? item?.obtainedMarks ?? 0),
    totalMarks: toNumber(item?.total_marks ?? item?.max_marks ?? item?.maxMarks ?? 0),
    isCorrect: Boolean(item?.is_correct ?? item?.isCorrect),
  }));
};

export default function ResultsPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [showAnswers, setShowAnswers] = useState(false);

  const resultQuery = useQuery({
    ...attemptResultQueryOptions(attemptId),
    enabled: Boolean(attemptId),
  });

  useEffect(() => {
    const err = resultQuery.error;
    if (!err) {
      return;
    }

    if (err.status === 409 && err.code === "ATTEMPT_IN_PROGRESS") {
      const activeAttempt = err?.details?.attempt_id || err?.details?.attemptId || attemptId;
      navigate(`/test/${activeAttempt}`, { replace: true });
    }
  }, [attemptId, navigate, resultQuery.error]);

  const result = resultQuery.data || {};

  const score = toNumber(result?.score ?? result?.summary?.score, 0);
  const percentile = toNumber(result?.percentile ?? result?.summary?.percentile, 0);
  const timeTaken = toNumber(result?.time_taken ?? result?.timeTaken ?? result?.timeSpentSeconds, 0);
  const reviewMode = resolveReviewMode(result);
  const endDate = resolveEndDate(result);
  const breakdown = useMemo(() => resolveBreakdown(result), [result]);
  const hasTestEnded = !endDate || Date.now() >= endDate;

  const showFullDetails = hasTestEnded && (reviewMode === "show_all" || reviewMode === "show_after_deadline");

  const violationSubmitted = Boolean(
    result?.violation_submit ||
      result?.violationSubmitted ||
      String(result?.submit_reason || result?.reason || "").toLowerCase().includes("violation")
  );

  if (resultQuery.isLoading) {
    return <div className="grid min-h-[60vh] place-items-center text-slate-500">Loading result...</div>;
  }

  if (resultQuery.error?.status === 403) {
    return (
      <section className="space-y-5">
        <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-700">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You do not have access</AlertDescription>
        </Alert>
      </section>
    );
  }

  if (resultQuery.isError) {
    return (
      <section className="space-y-5">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load results</AlertTitle>
          <AlertDescription>{resultQuery.error?.message || "Please try again in a moment."}</AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {violationSubmitted ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-800">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Submitted due to proctoring violation</AlertTitle>
          <AlertDescription>Your attempt was auto-submitted after crossing the allowed violation threshold.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Score</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{score}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Percentile</p>
          <p className="mt-2 text-3xl font-bold text-blue-700">{percentile}%</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Time Taken</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{formatDuration(timeTaken)}</p>
        </Card>
      </div>

     

      {!showFullDetails ? (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-900">Result Summary</h2>
          <p className="mt-2 text-sm text-slate-600">
            Answers are hidden until the test end time is completed.
          </p>
          {endDate ? (
            <p className="mt-1 text-xs text-slate-500">Available after: {new Date(endDate).toLocaleString()}</p>
          ) : null}
        </Card>
      ) : null}

      {showFullDetails ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Detailed Review</h2>
              <p className="mt-1 text-sm text-slate-600">View question-wise answers and marks once the test period has ended.</p>
            </div>
            <Button type="button" onClick={() => setShowAnswers((prev) => !prev)}>
              {showAnswers ? "Hide Answers" : "View Answers"}
            </Button>
          </div>
        </Card>
      ) : null}

      {showFullDetails && showAnswers ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Question Breakdown</h2>
          </div>

          {breakdown.length === 0 ? (
            <div className="p-6">
              <Empty className="border border-slate-100">
                <EmptyHeader>
                  <EmptyTitle>No Question Breakdown</EmptyTitle>
                  <EmptyDescription>Question-level details are not available for this attempt.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {breakdown.map((item, index) => (
                <article key={item.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">Q{index + 1}. {item.prompt}</p>
                    <p className="text-xs font-semibold text-slate-500">{item.topic}</p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Your answer</p>
                      <p className="mt-1 text-sm text-slate-800">{String(item.studentAnswer || "Not answered")}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Correct answer</p>
                      <p className="mt-1 text-sm text-slate-800">{String(item.correctAnswer || "-")}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Marks</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {item.marks}
                        {item.totalMarks > 0 ? ` / ${item.totalMarks}` : ""}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      ) : null}

       <div className="flex justify-center">
        <Button type="button" className="bg-blue-700 text-white p-6" onClick={() => navigate("/tests/ongoing")}>Return to Home</Button>
      </div> 
    </section>
  );
}
