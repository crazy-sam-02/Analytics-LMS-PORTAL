import { Button } from "@/components/ui/button";

const hasAnswer = (answer) => {
  if (!answer) return false;
  if (answer.selected_option) return true;
  if (Array.isArray(answer.selected_options) && answer.selected_options.length > 0) return true;
  if (typeof answer.answer_boolean === "boolean") return true;
  return Boolean(String(answer.answer_text || "").trim());
};

export function TestNavigationPanel({
  questionOrder,
  answers,
  markedForReview,
  currentIndex,
  onJump,
  onPrev,
  onNext,
  disableNext,
}) {
  const markedSet = new Set(markedForReview || []);

  const answeredCount = questionOrder.filter((questionId) => hasAnswer(answers[questionId])).length;

  return (
    <aside className="border-l border-slate-200 bg-slate-50 p-4">
      <p className="mb-3 text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase">Question Palette</p>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p>Answered: <span className="font-semibold text-emerald-700">{answeredCount}</span></p>
        <p>Unanswered: <span className="font-semibold text-rose-700">{questionOrder.length - answeredCount}</span></p>
        <p>Marked: <span className="font-semibold text-amber-700">{markedSet.size}</span></p>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {questionOrder.map((questionId, index) => {
          const marked = markedSet.has(questionId);
          const answered = hasAnswer(answers[questionId]);

          return (
            <button
              key={questionId}
              type="button"
              onClick={() => onJump(index)}
              className={`grid h-9 place-items-center rounded-lg border text-xs font-semibold transition ${
                index === currentIndex
                  ? "border-blue-600 bg-blue-600 text-white"
                  : marked
                    ? "border-amber-500 bg-amber-50 text-amber-700"
                    : answered
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={onPrev} disabled={currentIndex <= 0}>Prev</Button>
        <Button type="button" onClick={onNext} disabled={disableNext}>Next</Button>
      </div>
    </aside>
  );
}
