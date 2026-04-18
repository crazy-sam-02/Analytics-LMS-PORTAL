import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";

const EVENT_TYPES = ["Workshop", "Hackathon", "Symposium", "Other"];
const EVENT_PAGE_SIZE = 8;
const REGISTRANT_PAGE_SIZE = 10;

export default function EventsPage() {
  const queryClient = useQueryClient();
  const [selectedEventId, setSelectedEventId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [eventPage, setEventPage] = useState(1);
  const [registrantPage, setRegistrantPage] = useState(1);
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [fieldDraft, setFieldDraft] = useState({ name: "", type: "text", required: true });
  const [form, setForm] = useState({
    title: "",
    description: "",
    eventType: "Workshop",
    feeType: "free",
    registrationFee: "",
    startsAt: "",
    endsAt: "",
    eventDate: "",
    registrationDeadline: "",
    location: "",
    registrationLimit: 100,
    registrationUrl: "",
    registrationFields: [],
  });

  const eventsQuery = useQuery({ queryKey: ["admin-events"], queryFn: adminApi.getEvents });
  const selectedEventQuery = useQuery({
    queryKey: ["admin-event-registrants", selectedEventId],
    queryFn: () => adminApi.getEventRegistrants(selectedEventId),
    enabled: Boolean(selectedEventId),
  });

  const createMutation = useMutation({
    mutationFn: adminApi.createEvent,
    onSuccess: () => {
      toast.success("Event created.");
      setBanner({ type: "success", title: "Event created", message: "The event is published and visible in the list." });
      setForm({
        title: "",
        description: "",
        eventType: "Workshop",
        feeType: "free",
        registrationFee: "",
        startsAt: "",
        endsAt: "",
        eventDate: "",
        registrationDeadline: "",
        location: "",
        registrationLimit: 100,
        registrationUrl: "",
        registrationFields: [],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Create failed", message: error?.message || "Please validate event fields and retry." });
      toast.error(error?.message || "Failed to create event.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ eventId, reason }) => adminApi.cancelEvent(eventId, { reason }),
    onSuccess: () => {
      toast.success("Event cancelled. Registrants notified.");
      setBanner({ type: "success", title: "Event cancelled", message: "Cancellation reason saved and notifications dispatched." });
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-event-registrants", selectedEventId] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Cancellation failed", message: error?.message || "Unable to cancel this event." });
      toast.error(error?.message || "Failed to cancel event.");
    },
  });

  const events = useMemo(() => eventsQuery.data || [], [eventsQuery.data]);
  const pagedEvents = useMemo(() => {
    const start = (eventPage - 1) * EVENT_PAGE_SIZE;
    return events.slice(start, start + EVENT_PAGE_SIZE);
  }, [eventPage, events]);
  const totalEventPages = Math.max(1, Math.ceil(events.length / EVENT_PAGE_SIZE));

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) || null, [events, selectedEventId]);
  const registrants = useMemo(() => selectedEventQuery.data?.registrants || [], [selectedEventQuery.data]);
  const pagedRegistrants = useMemo(() => {
    const start = (registrantPage - 1) * REGISTRANT_PAGE_SIZE;
    return registrants.slice(start, start + REGISTRANT_PAGE_SIZE);
  }, [registrantPage, registrants]);
  const totalRegistrantPages = Math.max(1, Math.ceil(registrants.length / REGISTRANT_PAGE_SIZE));

  const addField = () => {
    if (!fieldDraft.name.trim()) {
      setBanner({ type: "warning", title: "Field name required", message: "Enter a field label before adding custom registration field." });
      toast.error("Field name is required.");
      return;
    }
    const trimmedName = fieldDraft.name.trim();
    const safeKey = trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || `field_${Date.now()}`;
    setForm((prev) => ({
      ...prev,
      registrationFields: [
        ...prev.registrationFields,
        {
          key: safeKey,
          label: trimmedName,
          type: fieldDraft.type,
          required: fieldDraft.required,
          options: [],
        },
      ],
    }));
    setFieldDraft({ name: "", type: "text", required: true });
  };

  const buildCreatePayload = () => {
    const eventDateIso = form.eventDate ? new Date(`${form.eventDate}T00:00:00`).toISOString() : undefined;
    const deadlineIso = form.registrationDeadline ? new Date(`${form.registrationDeadline}T00:00:00`).toISOString() : undefined;
    const registrationFee = form.feeType === "paid" ? Number(form.registrationFee || 0) : 0;
    const registrationFields = Array.isArray(form.registrationFields)
      ? form.registrationFields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: Boolean(field.required),
          options: Array.isArray(field.options) ? field.options : [],
        }))
      : [];

    // Persist fee metadata in existing JSON field without requiring DB schema changes.
    registrationFields.push({
      key: "registration_fee",
      label: "Registration Fee",
      type: "number",
      required: false,
      options: [],
      meta: {
        feeType: form.feeType,
        amount: registrationFee,
      },
    });

    return {
      ...form,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      eventDate: eventDateIso,
      registrationDeadline: deadlineIso,
      registrationUrl: form.registrationUrl?.trim() ? form.registrationUrl.trim() : null,
      feeType: form.feeType,
      registrationFee,
      registrationFields,
      maxParticipants: Number(form.registrationLimit),
    };
  };

  const downloadCsv = async () => {
    if (!selectedEventId) return;
    const csv = await adminApi.exportEventRegistrants(selectedEventId);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `event-${selectedEventId}-registrants.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Create Event</CardTitle>
          <CardDescription>Event date/deadline with custom registration fields and participant cap.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="event-title" className="text-sm font-medium text-slate-700">Title</label>
            <Input id="event-title" placeholder="Title" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="event-description" className="text-sm font-medium text-slate-700">Description</label>
            <Textarea id="event-description" placeholder="Description" value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="event-type" className="text-sm font-medium text-slate-700">Event type</label>
              <select id="event-type" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.eventType} onChange={(event) => setForm((prev) => ({ ...prev, eventType: event.target.value }))}>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-location" className="text-sm font-medium text-slate-700">Location</label>
              <Input id="event-location" placeholder="Location" value={form.location} onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-max-participants" className="text-sm font-medium text-slate-700">Max participants</label>
              <Input id="event-max-participants" type="number" min={1} placeholder="Max participants" value={form.registrationLimit} onChange={(event) => setForm((prev) => ({ ...prev, registrationLimit: Number(event.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-fee-type" className="text-sm font-medium text-slate-700">Registration fees</label>
              <select id="event-fee-type" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.feeType} onChange={(event) => setForm((prev) => ({ ...prev, feeType: event.target.value, registrationFee: event.target.value === "free" ? "" : prev.registrationFee }))}>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            {form.feeType === "paid" ? (
              <div className="space-y-1.5">
                <label htmlFor="event-registration-fee" className="text-sm font-medium text-slate-700">Amount</label>
                <Input id="event-registration-fee" type="number" min={0} step="0.01" placeholder="Amount" value={form.registrationFee} onChange={(event) => setForm((prev) => ({ ...prev, registrationFee: event.target.value }))} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="event-starts-at" className="text-sm font-medium text-slate-700">Starts at</label>
              <Input id="event-starts-at" type="datetime-local" value={form.startsAt} onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-ends-at" className="text-sm font-medium text-slate-700">Ends at</label>
              <Input id="event-ends-at" type="datetime-local" value={form.endsAt} onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-date" className="text-sm font-medium text-slate-700">Event date</label>
              <Input id="event-date" type="date" value={form.eventDate} onChange={(event) => setForm((prev) => ({ ...prev, eventDate: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="event-registration-deadline" className="text-sm font-medium text-slate-700">Registration deadline</label>
              <Input id="event-registration-deadline" type="date" value={form.registrationDeadline} onChange={(event) => setForm((prev) => ({ ...prev, registrationDeadline: event.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="event-registration-url" className="text-sm font-medium text-slate-700">Registration URL (optional)</label>
              <Input id="event-registration-url" placeholder="Registration URL (optional)" value={form.registrationUrl} onChange={(event) => setForm((prev) => ({ ...prev, registrationUrl: event.target.value }))} />
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-800">Custom Registration Fields</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="space-y-1.5">
                <label htmlFor="registration-field-name" className="text-sm font-medium text-slate-700">Field name</label>
                <Input id="registration-field-name" placeholder="Field name" value={fieldDraft.name} onChange={(event) => setFieldDraft((prev) => ({ ...prev, name: event.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="registration-field-type" className="text-sm font-medium text-slate-700">Field type</label>
                <select id="registration-field-type" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={fieldDraft.type} onChange={(event) => setFieldDraft((prev) => ({ ...prev, type: event.target.value }))}>
                  <option value="text">Text</option>
                  <option value="email">Email</option>
                  <option value="number">Number</option>
                  <option value="select">Select</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="registration-field-required" className="text-sm font-medium text-slate-700">Required</label>
                <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                  <input id="registration-field-required" type="checkbox" checked={fieldDraft.required} onChange={(event) => setFieldDraft((prev) => ({ ...prev, required: event.target.checked }))} />
                  Yes
                </label>
              </div>
              <Button type="button" variant="outline" onClick={addField}>Add Field</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.registrationFields.map((item, index) => (
                <span key={`${item.key || item.label}-${index}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {item.label} ({item.type}) {item.required ? "*" : ""}
                </span>
              ))}
            </div>
          </div>

          <Button onClick={() => createMutation.mutate(buildCreatePayload())} disabled={createMutation.isPending || !form.title || !form.startsAt || !form.eventDate || (form.feeType === "paid" && Number(form.registrationFee || 0) <= 0)}>
            {createMutation.isPending ? "Creating..." : "Create Event"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card className="rounded-2xl border-slate-200">
          <CardHeader><CardTitle>Events</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {eventsQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
              </div>
            ) : null}
            {eventsQuery.isError ? <p className="text-sm text-red-600">{eventsQuery.error?.message || "Unable to load events."}</p> : null}
            {!eventsQuery.isLoading && !eventsQuery.isError && pagedEvents.length === 0 ? <p className="text-sm text-slate-500">No events created yet.</p> : null}
            {pagedEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => {
                  setSelectedEventId(event.id);
                  setRegistrantPage(1);
                }}
                className={`w-full rounded-xl border px-3 py-2 text-left ${selectedEventId === event.id ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}
              >
                <p className="font-medium text-slate-800">{event.title}</p>
                <p className="text-xs text-slate-500">{event.eventType} • {new Date(event.startsAt).toLocaleString()} • {event.registrantCount || 0}/{event.registrationLimit}</p>
                {event.isCancelled ? <p className="mt-1 text-xs font-semibold text-red-600">Cancelled</p> : null}
              </button>
            ))}
            {events.length > EVENT_PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <p>Page {eventPage} of {totalEventPages}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={eventPage <= 1} onClick={() => setEventPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={eventPage >= totalEventPages} onClick={() => setEventPage((prev) => Math.min(prev + 1, totalEventPages))}>Next</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Participants</CardTitle>
            {selectedEvent ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={downloadCsv}>Export CSV</Button>
                <Button
                  variant="destructive"
                  onClick={() => cancelMutation.mutate({ eventId: selectedEvent.id, reason: cancelReason || "Cancelled by admin" })}
                  disabled={selectedEvent.isCancelled || cancelMutation.isPending}
                >
                  {selectedEvent.isCancelled ? "Cancelled" : "Cancel Event"}
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedEventQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-10" />
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
              </div>
            ) : null}
            {!selectedEvent ? <p className="text-sm text-slate-500">Select an event to manage participants.</p> : null}
            {selectedEvent ? (
              <>
                {!selectedEvent.isCancelled ? (
                  <Input placeholder="Cancellation reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
                ) : null}
                {pagedRegistrants.map((item) => (
                  <div key={`${item.studentId}-${item.registeredAt}`} className="rounded-xl border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-800">{item.student?.fullName || item.fullName || "Unknown"}</p>
                    <p className="text-xs text-slate-500">{item.student?.email || item.email || "-"} • {item.student?.batch?.name || "-"} • {item.status || "REGISTERED"}</p>
                    <p className="text-xs text-slate-500">Registered: {item.registeredAt ? new Date(item.registeredAt).toLocaleString() : "-"}</p>
                  </div>
                ))}
                {registrants.length === 0 ? <p className="text-sm text-slate-500">No participants yet.</p> : null}
                {registrants.length > REGISTRANT_PAGE_SIZE ? (
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                    <p>Page {registrantPage} of {totalRegistrantPages}</p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={registrantPage <= 1} onClick={() => setRegistrantPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={registrantPage >= totalRegistrantPages} onClick={() => setRegistrantPage((prev) => Math.min(prev + 1, totalRegistrantPages))}>Next</Button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
