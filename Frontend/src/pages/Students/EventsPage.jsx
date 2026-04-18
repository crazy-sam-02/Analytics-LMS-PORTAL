import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EventsSkeleton } from "@/components/common/page-skeletons";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { studentApi } from "@/services/studentApi";
import { eventsQueryOptions } from "@/services/studentQueries";
import { ui } from "@/styles/ui-tokens";
import { sanitizeText } from "@/lib/security";

const CATEGORY_TABS = [
  { value: "ALL", label: "All", eventType: null },
  { value: "HACKATHON", label: "Hackathon", eventType: "Hackathon" },
  { value: "SYMPOSIUM", label: "Symposium", eventType: "Symposium" },
  { value: "CULTURAL", label: "Cultural", eventType: "Cultural" },
  { value: "OTHER", label: "Other", eventType: "Other" },
];

const toMs = (value) => {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const getEventState = (event) => {
  const now = Date.now();
  const deadlineMs = toMs(event?.registration_deadline || event?.registrationDeadline);
  const availableSpots = Number(event?.available_spots ?? event?.availableSpots ?? event?.spotsLeft ?? 0);
  const registrationStatus = String(event?.status || event?.registrationStatus || "").toUpperCase();
  const isRegistered = Boolean(event?.is_registered || event?.registered || registrationStatus === "REGISTERED");

  if (isRegistered) {
    return "REGISTERED";
  }

  if (Boolean(event?.is_cancelled || event?.cancelled)) {
    return "CANCELLED";
  }

  if (availableSpots <= 0) {
    return "FULL";
  }

  if (deadlineMs > 0 && now > deadlineMs) {
    return "CLOSED";
  }

  return "OPEN";
};

export default function EventsPage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [localCancelledIds, setLocalCancelledIds] = useState([]);

  const eventsQuery = useQuery(eventsQueryOptions());

  const registerMutation = useMutation({
    mutationFn: (eventId) => studentApi.registerEvent(eventId),
    onSuccess: (_, eventId) => {
      queryClient.setQueryData(["student", "events"], (prev) => {
        const items = Array.isArray(prev?.items) ? prev.items : [];
        return {
          ...prev,
          items: items.map((item) =>
            String(item?.id) === String(eventId)
              ? { ...item, is_registered: true, registered: true }
              : item
          ),
        };
      });
      toast.success("Event registration successful.");
    },
    onError: (error, eventId) => {
      if (error?.code === "EVENT_FULL") {
        toast.error("This event is full.");
        return;
      }

      if (error?.code === "EVENT_CANCELLED") {
        if (error?.details?.eventId) {
          setLocalCancelledIds((prev) => [...new Set([...prev, String(error.details.eventId)])]);
        }
        toast.error("This event was cancelled and has been removed.");
        return;
      }

      if (error?.code === "ALREADY_REGISTERED") {
        queryClient.setQueryData(["student", "events"], (prev) => {
          const items = Array.isArray(prev?.items) ? prev.items : [];
          return {
            ...prev,
            items: items.map((item) =>
              String(item?.id) === String(eventId)
                ? { ...item, is_registered: true, registered: true, status: "REGISTERED" }
                : item
            ),
          };
        });
        toast.success("You are already registered for this event.");
        return;
      }

      toast.error(error?.message || "Unable to register for event.");
    },
  });

  const events = Array.isArray(eventsQuery.data?.items) ? eventsQuery.data.items : [];

  const filteredEvents = useMemo(() => {
    const selected = CATEGORY_TABS.find((item) => item.value === activeCategory);
    const activeItems = events.filter((event) => !localCancelledIds.includes(String(event?.id)));

    if (!selected?.eventType) return events;

    return activeItems.filter((event) =>
      String(event.eventType || "").toLowerCase() === selected.eventType.toLowerCase()
    );
  }, [events, activeCategory, localCancelledIds]);

  if (eventsQuery.isLoading) {
    return <EventsSkeleton />;
  }

  if (eventsQuery.isError) {
    return <div className="py-10 text-center text-sm text-slate-500">{eventsQuery.error?.message || "Unable to load events."}</div>;
  }

  return (
    <section className={ui.pageSection}>
      <article className="relative overflow-hidden rounded-3xl bg-linear-to-r from-[#0668c3] via-[#0b5ba8] to-[#0f1f34] p-7 text-white shadow-[0_18px_35px_-18px_rgba(11,84,158,0.6)]">
        <div className="max-w-md">
          <p className="text-xs font-semibold tracking-[0.16em] text-blue-100 uppercase">Featured Event</p>
          <h2 className="mt-2 text-5xl leading-[0.96] font-semibold tracking-tight">Discover Events</h2>
          <p className="mt-3 text-lg text-blue-50/90">Join hackathons, workshops, symposiums and community events curated for your track.</p>
          <Button className="mt-6 h-10 rounded-xl bg-white px-4 font-semibold text-[#055eb3] hover:bg-blue-50">
            Register Now
          </Button>
        </div>
      </article>

      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList>
          {CATEGORY_TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="px-3 text-sm data-active:bg-[#0569c9] data-active:text-white">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filteredEvents.map((event) => (
          <Card key={event.id} className={ui.cardPadding}>
            <div className="rounded-xl bg-linear-to-r from-[#f3f7fe] to-[#e9f2ff] p-3">
              <Badge className="bg-blue-100 text-[11px] font-semibold text-[#0a67bf] uppercase" variant="secondary">
                {sanitizeText(event.eventType || event.type || "Other")}
              </Badge>
              <h3 className="mt-3 text-lg leading-tight font-semibold text-slate-900">{sanitizeText(event.title || event.name)}</h3>
              <p className="mt-2 text-sm text-slate-600">{sanitizeText(event.description || "")}</p>
            </div>

            <div className="mt-3 grid gap-1 text-xs text-slate-500">
              <p>Date: {new Date(event.date || event.startsAt).toLocaleDateString()}</p>
              <p>Venue: {sanitizeText(event.venue || "TBA")}</p>
              <p>Registration Deadline: {new Date(event.registration_deadline || event.registrationDeadline || event.startsAt).toLocaleString()}</p>
              <p>Available Spots: {Number(event.available_spots ?? event.availableSpots ?? event.spotsLeft ?? 0)}</p>
            </div>

            <Button
              type="button"
              className="mt-4 h-9 w-full rounded-lg bg-[#0569c9] text-sm font-semibold shadow-md shadow-blue-700/20 hover:bg-[#0659a8]"
              disabled={registerMutation.isPending || ["REGISTERED", "FULL", "CLOSED", "CANCELLED"].includes(getEventState(event))}
              variant={["REGISTERED", "FULL", "CLOSED", "CANCELLED"].includes(getEventState(event)) ? "outline" : "default"}
              onClick={() => registerMutation.mutate(event.id)}
            >
              {getEventState(event) === "REGISTERED" ? "Registered" : "Register"}
            </Button>
          </Card>
        ))}
        {!eventsQuery.isLoading && filteredEvents.length === 0 ? (
          <Card className={`${ui.cardPadding} col-span-full text-center text-sm text-slate-500`}>
            No events found for this category.
          </Card>
        ) : null}
      </div>
    </section>
  );
}
