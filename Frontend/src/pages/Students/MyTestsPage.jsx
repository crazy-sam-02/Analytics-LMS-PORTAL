import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { Sigma, Brain, Timer, CalendarClock, Sparkles } from "lucide-react";
import { TestsSkeleton } from "@/components/common/page-skeletons";
import { fetchMyTests } from "@/features/Students/testSlice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ui } from "@/styles/ui-tokens";

const iconByIndex = [Sigma, Brain, Timer];

export default function MyTestsPage() {
  const dispatch = useDispatch();
  const { ongoing, upcoming, testsLoading } = useSelector((state) => state.test);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    dispatch(fetchMyTests());
  }, [dispatch]);

  useEffect(() => {
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  if (testsLoading) {
    return <TestsSkeleton />;
  }

  return (
    <section className={ui.pageSection}>
      <div className="grid gap-4 lg:grid-cols-1 xl:grid-cols-[1.45fr_1fr]">
        <Card className={ui.cardPadding}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-[#0f1f36]">Ongoing Tests</h2>
            <Badge variant="secondary" className="bg-blue-50 text-xs font-semibold text-[#0a6bc8]">{ongoing.length} Active</Badge>
          </div>

          <div className="space-y-4">
            {ongoing.map((test, index) => {
              const Icon = iconByIndex[index % iconByIndex.length];
              return (
                <Card key={test.id} className="rounded-xl border border-slate-200 bg-[#fbfcff] p-4 shadow-none">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 gap-3">
                      <div className="grid size-10 place-items-center rounded-lg bg-blue-100 text-[#0a6bc8]">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-lg md:text-xl font-semibold tracking-tight text-slate-900">{test.title}</p>
                        <p className="text-sm text-slate-500">Subject: {test.subject}</p>
                      </div>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Time Remaining</p>
                      <p className="text-base font-semibold text-slate-700">
                        {test.isCompleted
                          ? "Completed"
                          : `${Math.max(0, Math.round((new Date(test.endsAt).getTime() - nowMs) / 60000))} min`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                      <span>Progress</span>
                      <span>{test.progress || 0}%</span>
                    </div>
                    <Progress className="h-2 bg-slate-200 **:data-[slot=progress-indicator]:bg-[#0a6bc8]" value={test.progress || 0} />
                  </div>

                  {test.isCompleted ? (
                    <Badge variant="secondary" className="mt-4 bg-emerald-100 text-emerald-800">Completed</Badge>
                  ) : (
                    <Button asChild className="mt-4 h-10 rounded-lg bg-[#0569c9] px-4 text-sm font-semibold shadow-md shadow-blue-700/20 hover:bg-[#0659a8]">
                      <Link to={`/tests/${test.id}/take`}>{test.canTryAgain ? "Try Again" : "Resume"}</Link>
                    </Button>
                  )}
                </Card>
              );
            })}

            {ongoing.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No ongoing tests found.</p> : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className={ui.cardPadding}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Upcoming Tests</h2>
              <span className="text-xs font-semibold text-slate-500">View Calendar</span>
            </div>

            <div className="space-y-3">
              {upcoming.map((test) => (
                <Card key={test.id} className="rounded-xl border-l-4 border-l-[#0a6bc8] border-slate-200 bg-[#fbfcff] p-4 shadow-none">
                  <p className="font-semibold text-slate-900">{test.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{test.subject}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <CalendarClock className="size-3.5" />
                    {new Date(test.startsAt).toLocaleString()}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Duration: {test.durationMins} minutes</p>
                </Card>
              ))}

              {upcoming.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">No upcoming tests found.</p> : null}
            </div>
          </Card>

          <Card className="rounded-2xl bg-linear-to-br from-[#0668c3] to-[#0f4f96] p-5 md:p-6 text-white shadow-[0_18px_35px_-18px_rgba(11,84,158,0.6)]">
            <div className="flex items-center gap-2 text-blue-100">
              <Sparkles className="size-4" />
              <p className="text-xs font-semibold tracking-[0.14em] uppercase">Smart Insight</p>
            </div>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight">Ace Your Next Exam</h3>
            <p className="mt-2 text-sm text-blue-50/90">Get personalized recommendations based on your recent ongoing test performance.</p>
            <Button className="mt-4 h-9 rounded-lg bg-white text-[#0569c9] hover:bg-blue-50">Review Insights</Button>
          </Card>
        </div>
      </div>

      <Card className={ui.cardPadding}>
        <h3 className="text-lg font-semibold text-slate-900">Engagement Trend</h3>
        <p className="text-sm text-slate-500">Average time spent per test module this week</p>
        <div className="mt-4 flex h-44 items-end gap-2">
          {[28, 48, 35, 64, 82, 42, 30, 56, 44, 61, 32, 39].map((height, index) => (
            <div key={index} className="flex-1 rounded-t bg-slate-200" style={{ height: `${height}%`, backgroundColor: index === 4 ? "#0a6bc8" : undefined }} />
          ))}
        </div>
      </Card>
    </section>
  );
}
