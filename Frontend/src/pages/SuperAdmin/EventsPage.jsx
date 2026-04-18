import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";

const EVENT_TYPES = ["Workshop", "Hackathon", "Symposium", "Other"];
const PAGE_SIZE = 8;

const EMPTY_FORM = {
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
  allColleges: true,
  collegeIds: [],
};

export default function EventsPage() {
  const dispatch = useDispatch();
  const colleges = useSelector((state) => state.superAdminPanel.colleges);

  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [form, setForm] = useState(EMPTY_FORM);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const response = await superAdminApi.getEvents("?page=1&limit=100");
      setEvents(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      setBanner({ type: "error", title: "Failed to load events", message: error?.message || "Unable to fetch global events." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    dispatch(fetchSuperColleges());
    loadEvents();
  }, [dispatch]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return events;
    return events.filter((item) => {
      const text = `${item.title || ""} ${item.eventType || ""} ${item.college?.name || ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [events, search]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const pagedEvents = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, page]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const buildPayload = () => {
    const registrationFee = form.feeType === "paid" ? Number(form.registrationFee || 0) : 0;
    const registrationFields = [
      {
        key: "registration_fee",
        label: "Registration Fee",
        type: "number",
        required: false,
        options: [],
        meta: {
          feeType: form.feeType,
          amount: registrationFee,
        },
      },
    ];

    return {
      title: form.title.trim(),
      description: form.description.trim(),
      eventType: form.eventType,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      eventDate: form.eventDate ? new Date(`${form.eventDate}T00:00:00`).toISOString() : null,
      registrationDeadline: form.registrationDeadline ? new Date(`${form.registrationDeadline}T00:00:00`).toISOString() : null,
      location: form.location.trim() || null,
      registrationLimit: Number(form.registrationLimit),
      maxParticipants: Number(form.registrationLimit),
      registrationUrl: form.registrationUrl?.trim() ? form.registrationUrl.trim() : null,
      registrationFields,
      allColleges: form.allColleges,
      collegeIds: form.allColleges ? [] : form.collegeIds,
      feeType: form.feeType,
      registrationFee,
    };
  };

  const save = async () => {
    if (!form.title.trim() || !form.description.trim() || !form.startsAt || !form.endsAt) {
      setBanner({ type: "warning", title: "Missing details", message: "Title, description, starts at, and ends at are required." });
      return;
    }

    if (!form.allColleges && form.collegeIds.length === 0) {
      setBanner({ type: "warning", title: "No college selected", message: "Select at least one college or choose all colleges." });
      return;
    }

    if (form.feeType === "paid" && Number(form.registrationFee || 0) <= 0) {
      setBanner({ type: "warning", title: "Invalid fee amount", message: "Enter a paid registration amount greater than 0." });
      return;
    }

    setSubmitting(true);
    try {
      await superAdminApi.createEvent(buildPayload());
      toast.success("Global event created.");
      setBanner({ type: "success", title: "Global event created", message: "Event has been rolled out to target colleges." });
      setForm(EMPTY_FORM);
      await loadEvents();
    } catch (error) {
      setBanner({ type: "error", title: "Create failed", message: error?.message || "Unable to create global event." });
      toast.error(error?.message || "Failed to create event.");
    } finally {
      setSubmitting(false);
    }
  };

  const canCreate = Boolean(form.title.trim() && form.description.trim() && form.startsAt && form.endsAt && Number(form.registrationLimit) > 0 && (form.feeType !== "paid" || Number(form.registrationFee || 0) > 0));

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
          <CardTitle>Create Global Event</CardTitle>
          <CardDescription>Admin-like event creation with super admin controls for multi-college targeting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="super-event-title" className="text-sm font-medium text-slate-700">Title</label>
            <Input id="super-event-title" placeholder="Title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="super-event-description" className="text-sm font-medium text-slate-700">Description</label>
            <Textarea id="super-event-description" placeholder="Description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="super-event-type" className="text-sm font-medium text-slate-700">Event type</label>
              <select id="super-event-type" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.eventType} onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value }))}>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-location" className="text-sm font-medium text-slate-700">Location</label>
              <Input id="super-event-location" placeholder="Location" value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-max-participants" className="text-sm font-medium text-slate-700">Max participants</label>
              <Input id="super-event-max-participants" type="number" min={1} placeholder="Max participants" value={form.registrationLimit} onChange={(e) => setForm((prev) => ({ ...prev, registrationLimit: Number(e.target.value) }))} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="super-event-fee-type" className="text-sm font-medium text-slate-700">Registration fees</label>
              <select id="super-event-fee-type" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.feeType} onChange={(e) => setForm((prev) => ({ ...prev, feeType: e.target.value, registrationFee: e.target.value === "free" ? "" : prev.registrationFee }))}>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            {form.feeType === "paid" ? (
              <div className="space-y-1.5">
                <label htmlFor="super-event-fee-amount" className="text-sm font-medium text-slate-700">Amount</label>
                <Input id="super-event-fee-amount" type="number" min={0} step="0.01" placeholder="Amount" value={form.registrationFee} onChange={(e) => setForm((prev) => ({ ...prev, registrationFee: e.target.value }))} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="super-event-starts-at" className="text-sm font-medium text-slate-700">Starts at</label>
              <Input id="super-event-starts-at" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((prev) => ({ ...prev, startsAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-ends-at" className="text-sm font-medium text-slate-700">Ends at</label>
              <Input id="super-event-ends-at" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((prev) => ({ ...prev, endsAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-date" className="text-sm font-medium text-slate-700">Event date</label>
              <Input id="super-event-date" type="date" value={form.eventDate} onChange={(e) => setForm((prev) => ({ ...prev, eventDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="super-event-deadline" className="text-sm font-medium text-slate-700">Registration deadline</label>
              <Input id="super-event-deadline" type="date" value={form.registrationDeadline} onChange={(e) => setForm((prev) => ({ ...prev, registrationDeadline: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="super-event-registration-url" className="text-sm font-medium text-slate-700">Registration URL (optional)</label>
              <Input id="super-event-registration-url" placeholder="Registration URL" value={form.registrationUrl} onChange={(e) => setForm((prev) => ({ ...prev, registrationUrl: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="super-event-all-colleges" className="text-sm font-medium text-slate-700">College assignment</label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input id="super-event-all-colleges" type="checkbox" checked={form.allColleges} onChange={(e) => setForm((prev) => ({ ...prev, allColleges: e.target.checked }))} />
              Assign to all colleges
            </label>
          </div>

          {!form.allColleges ? (
            <div className="space-y-1.5">
              <label htmlFor="super-event-colleges" className="text-sm font-medium text-slate-700">Select colleges</label>
              <select id="super-event-colleges" multiple className="min-h-24 w-full rounded-lg border border-slate-200 p-2" value={form.collegeIds} onChange={(e) => setForm((prev) => ({ ...prev, collegeIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>
                {colleges.map((college) => (
                  <option key={college.id} value={college.id}>{college.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <Button className="bg-blue-500 hover:bg-blue-600" onClick={save} disabled={!canCreate || submitting}>
            {submitting ? "Creating..." : "Create Global Event"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Global Events</CardTitle>
          <CardDescription>Admin-like event list with search and pagination for portfolio-wide visibility.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="super-event-search" className="text-sm font-medium text-slate-700">Search events</label>
            <Input id="super-event-search" placeholder="Search by title, type, or college" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {loading ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
            </div>
          ) : null}

          {!loading && pagedEvents.length === 0 ? <p className="text-sm text-slate-500">No global events found.</p> : null}

          {!loading ? (
            <div className="space-y-2">
              {pagedEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-slate-200 px-3 py-2">
                  <p className="font-medium text-slate-800">{event.title}</p>
                  <p className="text-xs text-slate-500">{event.eventType} | {event.college?.name || "All colleges"}</p>
                  <p className="text-xs text-slate-500">{event.startsAt ? new Date(event.startsAt).toLocaleString() : "-"} to {event.endsAt ? new Date(event.endsAt).toLocaleString() : "-"}</p>
                </div>
              ))}
            </div>
          ) : null}

          {filteredEvents.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
              <p>Page {page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
