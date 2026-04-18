import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useParams, Link } from "react-router-dom";
import { Check, Clock3, FileDigit } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SubmissionPage() {
  const { submissionId } = useParams();
  const finalSubmission = useSelector((state) => state.test.finalSubmission);
  const [showDetails, setShowDetails] = useState(false);

  const detailRows = useMemo(
    () => [
      { label: "Status", value: finalSubmission?.status || "Unknown" },
      { label: "Score", value: finalSubmission?.score ?? "N/A" },
      { label: "Accuracy", value: finalSubmission?.accuracy != null ? `${finalSubmission.accuracy}%` : "N/A" },
      { label: "Attempt", value: finalSubmission?.attemptNumber ?? "N/A" },
      {
        label: "Submitted At",
        value: finalSubmission?.submittedAt ? new Date(finalSubmission.submittedAt).toLocaleString() : "N/A",
      },
    ],
    [finalSubmission]
  );

  return (
    <section className="grid min-h-[80vh] place-items-center bg-[#f2f5fb] p-4">
      <article className="w-full max-w-2xl text-center">
        <div className="mx-auto grid size-24 place-items-center rounded-3xl bg-white shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100 sm:size-30">
          <div className="grid size-14 place-items-center rounded-full bg-[#0569c9] text-white sm:size-18">
            <Check className="size-10" />
          </div>
        </div>

        <h1 className="mt-6 text-4xl leading-[0.95] font-semibold tracking-tight text-[#0a4f96] sm:mt-8 sm:text-6xl">Assessment Submitted</h1>
        <p className="mx-auto mt-3 max-w-md text-base text-slate-600 sm:text-xl">
          You have successfully submitted the assessment. Your hard work is now being processed.
        </p>

        <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100">
            <div className="grid size-11 place-items-center rounded-xl bg-blue-100 text-[#0569c9]"><Clock3 className="size-5" /></div>
            <div>
              <p className="text-xs tracking-wide text-slate-500 uppercase">Time Spent</p>
              <p className="text-lg font-semibold text-slate-800">{Math.round((finalSubmission?.timeSpentSeconds || 0) / 60)} Minutes</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100">
            <div className="grid size-11 place-items-center rounded-xl bg-blue-100 text-[#0569c9]"><FileDigit className="size-5" /></div>
            <div>
              <p className="text-xs tracking-wide text-slate-500 uppercase">Submission ID</p>
              <p className="text-lg font-semibold text-slate-800">#{submissionId}</p>
            </div>
          </div>
        </div>

        <Button asChild className="mt-8 h-12 rounded-xl bg-[#0569c9] px-8 text-base font-semibold shadow-lg shadow-blue-700/25 hover:bg-[#0558a8]">
          <Link to="/tests/ongoing">Back to On-Going Tests</Link>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="mt-4 h-10 rounded-xl border-blue-200 text-sm font-semibold text-[#0a4f96]"
          onClick={() => setShowDetails((prev) => !prev)}
        >
          {showDetails ? "Hide Submission Details" : "View Submission Details"}
        </Button>

        {showDetails ? (
          <div className="mt-4 rounded-2xl bg-white p-5 text-left shadow-[0_18px_35px_-24px_rgba(18,33,73,0.42)] ring-1 ring-slate-100">
            <h3 className="text-base font-semibold text-slate-900">Submission Snapshot</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {detailRows.map((row) => (
                <div key={row.label} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{row.label}</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{row.value}</p>
                </div>
              ))}
            </div>
            {!finalSubmission ? (
              <p className="mt-3 text-xs text-slate-500">Detailed data is unavailable after page refresh. Open Reports for historical records.</p>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}
