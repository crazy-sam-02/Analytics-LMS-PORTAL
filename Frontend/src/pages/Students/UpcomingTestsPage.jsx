import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Clock3, Rocket } from "lucide-react";
import { upcomingTestsQueryOptions, testSessionQueryOptions } from "@/services/studentQueries";
import { studentApi } from "@/services/studentApi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const pickId = (item) => item?.id || item?.test_id || item?.testId;

const dedupeTests = (items) => {
  const map = new Map();

  (items || []).forEach((item) => {
    const id = pickId(item);
    if (!id || map.has(id)) {
      return;
    }

    map.set(id, {
      ...item,
      id,
    });
  });

  return [...map.values()];
};

const formatDate = (dateValue) =>
  new Date(dateValue).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const toCountdown = (ms) => {
  if (ms <= 0) {
    return "Live now";
  }

  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) {
    return `Starts in ${days}d ${hours}h ${minutes}m`;
  }

  return `Starts in ${hours}h ${minutes}m ${seconds}s`;
};

export default function UpcomingTestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const previousIdsRef = useRef(new Set());

  const { data } = useQuery(upcomingTestsQueryOptions());
  const startAttemptMutation = useMutation({
    mutationFn: ({ test_id }) => studentApi.startAttempt({ test_id }),
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((current) => current + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const now = useMemo(() => {
    const baseServerTime = data?.serverTime || Date.now();
    return baseServerTime + tick * 1000;
  }, [data?.serverTime, tick]);

  const tests = useMemo(() => dedupeTests(data?.items), [data?.items]);

  useEffect(() => {
    const currentIds = new Set(tests.map((test) => String(test.id)));

    if (previousIdsRef.current.size > 0) {
      const removedCount = [...previousIdsRef.current].filter((id) => !currentIds.has(id)).length;
      if (removedCount > 0) {
        toast.info(`${removedCount} upcoming test${removedCount > 1 ? "s were" : " was"} removed.`);
      }
    }

    previousIdsRef.current = currentIds;
  }, [tests]);

  const { upcoming, past } = useMemo(() => {
    const upcomingList = [];
    const pastList = [];

    tests.forEach((test) => {
      const start = new Date(test.startsAt || test.startAt || 0).getTime();
      const end = new Date(test.endsAt || test.endTime || 0).getTime();

      if (Number.isFinite(end) && end > 0 && now > end) {
        pastList.push({ ...test, start, end, state: "MISSED" });
        return;
      }

      if (Number.isFinite(start) && start > now) {
        upcomingList.push({ ...test, start, end, state: "LOCKED" });
        return;
      }

      upcomingList.push({ ...test, start, end, state: "LIVE" });
    });

    upcomingList.sort((a, b) => a.start - b.start);
    pastList.sort((a, b) => b.end - a.end);

    return {
      upcoming: upcomingList,
      past: pastList,
    };
  }, [now, tests]);

  if (tests.length === 0) {
    return (
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold text-slate-900">Upcoming Tests</h1>
        <Card className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-lg font-semibold text-slate-800">No upcoming tests</p>
          <p className="mt-2 text-sm text-slate-500">New schedules will appear here automatically.</p>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Card className="rounded-2xl bg-linear-to-br from-[#0569c9] to-[#0f4f96] p-6 text-white shadow-[0_22px_45px_-25px_rgba(11,84,158,0.65)]">
        <div className="flex items-center gap-2 text-blue-100">
          <Rocket className="size-4" />
          <p className="text-xs font-semibold tracking-[0.12em] uppercase">Upcoming Window</p>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Upcoming Tests</h1>
        <p className="mt-2 text-sm text-blue-50/90">Start access is validated on server when you click Attend Now.</p>
      </Card>

      <div className="space-y-4">
        {upcoming.map((test) => {
          const countdown = toCountdown(test.start - now);

          return (
            <Card key={test.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="truncate text-lg font-semibold text-slate-900">{test.title || test.name || "Untitled Test"}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
                      <CalendarClock className="size-3.5" />
                      {formatDate(test.startsAt || test.startAt)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
                      <Clock3 className="size-3.5" />
                      {test.durationMins || test.duration || 0} mins
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-1">Attempts: {test.attemptsAllowed || 1}</span>
                  </div>
                  <p className="text-sm text-slate-500">{countdown}</p>
                </div>

                {test.state === "LOCKED" ? (
                  <Badge variant="secondary" className="bg-slate-100 text-slate-700">Locked</Badge>
                ) : (
                  <Button
                    className="h-10 rounded-lg bg-blue-700 hover:bg-blue-800"
                    disabled={startAttemptMutation.isPending}
                    onMouseEnter={() => {
                      queryClient.prefetchQuery(testSessionQueryOptions(test.id));
                    }}
                    onClick={() => {
                      startAttemptMutation
                        .mutateAsync({ test_id: test.id })
                        .then((payload) => {
                          const attemptId = payload?.attempt_id || payload?.attemptId || payload?.submission?.id;
                          if (!attemptId) {
                            throw new Error("Attempt id missing");
                          }
                          navigate(`/test/${attemptId}`);
                        })
                        .catch(() => {
                          toast.error("Unable to start test. Please retry.");
                        });
                    }}
                  >
                    Attend Now
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Past (Missed)</h2>
        {past.length === 0 ? (
          <Card className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
            No missed tests.
          </Card>
        ) : (
          past.map((test) => (
            <Card key={test.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-800">{test.title || test.name || "Untitled Test"}</p>
                  <p className="text-xs text-slate-500">Ended {formatDate(test.endsAt || test.endTime)}</p>
                </div>
                <Badge variant="secondary" className="bg-rose-100 text-rose-700">Missed</Badge>
              </div>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}
