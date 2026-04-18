import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { fetchAdminTests, transitionAdminTestStatus, deleteAdminTest, duplicateAdminTest } from "@/features/Admin/adminPanelSlice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import TestCreationDialog from "@/components/Admin/TestCreationDialog";
import PermissionDenied from "@/components/Admin/PermissionDenied";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import usePermission from "@/hooks/usePermission";
import { ADMIN_PERMISSIONS } from "@/features/Admin/adminPermissions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const STATUS_TONE = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  SCHEDULED: "bg-blue-50 text-blue-700 border-blue-200",
  LIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  COMPLETED: "bg-teal-50 text-teal-700 border-teal-200",
  ARCHIVED: "bg-slate-50 text-slate-500 border-slate-200",
};

const normalizeStatus = (status) => {
  if (status === "UPCOMING") return "SCHEDULED";
  if (status === "PUBLISHED") return "LIVE";
  return status || "DRAFT";
};

const STATUS_FILTERS = ["ALL", "DRAFT", "SCHEDULED", "LIVE", "COMPLETED", "ARCHIVED"];
const SORT_FIELDS = [
  { value: "createdAt", label: "Created Date" },
  { value: "startsAt", label: "Start Date" },
  { value: "title", label: "Test Name" },
  { value: "status", label: "Status" },
];

const transitionsForStatus = (status) => {
  switch (status) {
    case "DRAFT":
      return [
        { action: "SCHEDULE", label: "Schedule" },
        { action: "GO_LIVE", label: "Go Live" },
        { action: "ARCHIVE", label: "Archive" },
      ];
    case "SCHEDULED":
      return [
        { action: "GO_LIVE", label: "Go Live" },
        { action: "ARCHIVE", label: "Archive" },
      ];
    case "LIVE":
      return [
        { action: "COMPLETE", label: "Mark Complete" },
        { action: "ARCHIVE", label: "Archive" },
      ];
    case "COMPLETED":
      return [{ action: "ARCHIVE", label: "Archive" }];
    default:
      return [];
  }
};

const transitionConfirmationText = (testTitle, action) => {
  switch (action) {
    case "SCHEDULE":
      return `Schedule "${testTitle}" as upcoming? Students will see it before start time.`;
    case "GO_LIVE":
      return `Go live now for "${testTitle}"? Questions become locked for editing after publish.`;
    case "COMPLETE":
      return `Mark "${testTitle}" as completed? This will stop it from remaining active.`;
    case "ARCHIVE":
      return `Archive "${testTitle}"? It will be hidden from active admin workflows but retained for reports.`;
    default:
      return `Apply transition ${action} for "${testTitle}"?`;
  }
};

export default function ManageTestsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const tests = useSelector((state) => state.adminPanel.tests.data);
  const loading = useSelector((state) => state.adminPanel.tests.loading);
  const pagination = useSelector((state) => state.adminPanel.tests.pagination || {});
  const serverStatusCounts = useSelector((state) => state.adminPanel.tests.statusCounts || {});
  const canCreate = usePermission(ADMIN_PERMISSIONS.CREATE_TEST);
  const canPublish = usePermission(ADMIN_PERMISSIONS.PUBLISH_TEST);
  const canEdit = usePermission(ADMIN_PERMISSIONS.EDIT_TEST);
  const canDelete = usePermission(ADMIN_PERMISSIONS.DELETE_TEST);
  const [activeStatus, setActiveStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState("ARCHIVE");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteDialog, setDeleteDialog] = useState({ open: false, test: null });

  const canTransition = canEdit || canPublish;

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", "20");
    query.set("sortBy", sortBy);
    query.set("sortOrder", sortOrder);
    if (activeStatus !== "ALL") query.set("status", activeStatus);
    if (search.trim().length >= 2) query.set("search", search.trim());
    return `?${query.toString()}`;
  }, [activeStatus, page, search, sortBy, sortOrder]);

  useEffect(() => {
    if (canEdit || canPublish || canCreate) {
      dispatch(fetchAdminTests(queryString));
    }
  }, [canCreate, canEdit, canPublish, dispatch, queryString]);

  useEffect(() => {
    setSelectedIds([]);
  }, [tests]);

  const fallbackStatusCounts = useMemo(() => {
    const base = {
      DRAFT: 0,
      SCHEDULED: 0,
      LIVE: 0,
      COMPLETED: 0,
      ARCHIVED: 0,
    };

    tests.forEach((test) => {
      const status = normalizeStatus(test.status);
      if (typeof base[status] === "number") {
        base[status] += 1;
      }
    });

    return base;
  }, [tests]);

  const statusCounts = {
    ALL: Number(serverStatusCounts.ALL ?? tests.length),
    DRAFT: Number(serverStatusCounts.DRAFT ?? fallbackStatusCounts.DRAFT),
    SCHEDULED: Number(serverStatusCounts.SCHEDULED ?? fallbackStatusCounts.SCHEDULED),
    LIVE: Number(serverStatusCounts.LIVE ?? fallbackStatusCounts.LIVE),
    COMPLETED: Number(serverStatusCounts.COMPLETED ?? fallbackStatusCounts.COMPLETED),
    ARCHIVED: Number(serverStatusCounts.ARCHIVED ?? fallbackStatusCounts.ARCHIVED),
  };

  const onTransition = (test, action) => {
    setPendingAction({
      type: "transition",
      test,
      action,
      description: transitionConfirmationText(test.title, action),
    });
  };

  const onDeleteDraft = (test) => {
    setDeleteConfirmName("");
    setDeleteDialog({ open: true, test });
  };

  const confirmPendingAction = () => {
    if (!pendingAction?.test?.id) {
      setPendingAction(null);
      return;
    }

    if (pendingAction.type === "transition") {
      dispatch(
        transitionAdminTestStatus({
          testId: pendingAction.test.id,
          action: pendingAction.action,
        })
      );
    }

    setPendingAction(null);
  };

  const selectedTests = tests.filter((test) => selectedIds.includes(test.id));
  const bulkPreview = useMemo(() => {
    if (bulkAction === "ARCHIVE") {
      const valid = selectedTests.filter((test) => normalizeStatus(test.status) !== "ARCHIVED").length;
      return { valid, skipped: selectedTests.length - valid };
    }

    const valid = selectedTests.filter(
      (test) => normalizeStatus(test.status) === "DRAFT" && Number(test?._count?.submissions || 0) === 0
    ).length;
    return { valid, skipped: selectedTests.length - valid };
  }, [bulkAction, selectedTests]);

  const runBulkAction = async () => {
    const actionPromises = selectedTests.map(async (test) => {
      if (bulkAction === "ARCHIVE") {
        if (normalizeStatus(test.status) === "ARCHIVED") return false;
        await dispatch(transitionAdminTestStatus({ testId: test.id, action: "ARCHIVE" }));
        return true;
      }

      if (normalizeStatus(test.status) === "DRAFT" && Number(test?._count?.submissions || 0) === 0) {
        await dispatch(deleteAdminTest(test.id));
        return true;
      }

      return false;
    });

    const results = await Promise.all(actionPromises);
    const valid = results.filter(Boolean).length;
    const skipped = results.length - valid;
    toast.success(`${valid} processed, ${skipped} skipped.`);
    setBulkOpen(false);
  };

  const onDuplicate = async (testId) => {
    await dispatch(duplicateAdminTest(testId));
    toast.success("Test duplicated as draft copy.");
  };

  if (!canEdit && !canPublish && !canCreate) {
    return <PermissionDenied action="view or manage tests" />;
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Create Test</CardTitle>
            <CardDescription>Open the multi-step modal to create, validate, and publish tests.</CardDescription>
          </div>
          {canCreate ? <TestCreationDialog /> : <PermissionDenied action="create tests" />}
        </CardHeader>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Existing Tests</CardTitle>
          <CardDescription>Use lifecycle filters and transition actions to manage test state safely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by name or description" />
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {SORT_FIELDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
            <Button variant="outline" onClick={() => setBulkOpen(true)} disabled={selectedIds.length === 0}>Bulk Actions ({selectedIds.length})</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((status) => {
              const isActive = activeStatus === status;
              const count = statusCounts[status] || 0;
              return (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  onClick={() => { setActiveStatus(status); setPage(1); }}
                >
                  {status} ({count})
                </Button>
              );
            })}
          </div>

          {loading ? <p className="text-sm text-slate-500">Loading tests...</p> : null}
          {!loading && tests.length === 0 ? <p className="text-sm text-slate-500">No tests available.</p> : null}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left"><input type="checkbox" checked={tests.length > 0 && selectedIds.length === tests.length} onChange={(event) => setSelectedIds(event.target.checked ? tests.map((item) => item.id) : [])} /></th>
                  <th className="px-3 py-2 text-left">Test Name</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Date Range</th>
                  <th className="px-3 py-2 text-left">Attempts</th>
                  <th className="px-3 py-2 text-left">Avg Score</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {tests.map((test) => {
                  const totalAttempts = Number(test?._count?.submissions || 0);
                  return (
                    <tr key={test.id}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selectedIds.includes(test.id)} onChange={(event) => setSelectedIds((prev) => event.target.checked ? [...new Set([...prev, test.id])] : prev.filter((id) => id !== test.id))} /></td>
                      <td className="px-3 py-2 font-medium text-slate-800">{test.title}</td>
                      <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[normalizeStatus(test.status)] || STATUS_TONE.DRAFT}`}>{normalizeStatus(test.status)}</span></td>
                      <td className="px-3 py-2 text-slate-600">{test?.department?.name || "Department"} / {test?.batchAssignments?.length || 0} batches</td>
                      <td className="px-3 py-2 text-slate-600">{new Date(test.startsAt).toLocaleDateString()} - {new Date(test.endsAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-slate-600">{totalAttempts}</td>
                      <td className="px-3 py-2 text-slate-600">{totalAttempts > 0 ? "Computed" : "-"}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => onDuplicate(test.id)}>Duplicate</Button>
                          {normalizeStatus(test.status) === "LIVE" ? (
                            <Button size="sm" variant="outline" onClick={() => navigate(`/admin/tests/${test.id}/monitor`)}>Monitor Live</Button>
                          ) : null}
                          {canTransition ? transitionsForStatus(normalizeStatus(test.status)).map((transition) => (
                            <Button key={`${test.id}-${transition.action}`} type="button" size="sm" variant={transition.action === "ARCHIVE" ? "ghost" : "outline"} onClick={() => onTransition(test, transition.action)}>{transition.label}</Button>
                          )) : null}
                          {canDelete && normalizeStatus(test.status) === "DRAFT" ? <Button size="sm" variant="destructive" onClick={() => onDeleteDraft(test)}>Delete</Button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">Page {pagination.page || page} of {pagination.totalPages || 1}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={(pagination.page || page) <= 1}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setPage((prev) => prev + 1)} disabled={(pagination.page || page) >= (pagination.totalPages || 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction?.type === "delete" ? "Confirm Draft Deletion" : "Confirm Status Transition"}
        description={pendingAction?.description || "Please confirm this action."}
        confirmLabel={pendingAction?.type === "delete" ? "Delete" : "Confirm"}
        confirmVariant={pendingAction?.type === "delete" ? "destructive" : "default"}
        onConfirm={confirmPendingAction}
      />

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Draft Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Type <strong>{deleteDialog.test?.title}</strong> to permanently delete this draft test.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-name">Test name</Label>
            <Input id="delete-name" value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmName.trim() !== String(deleteDialog.test?.title || "")}
              onClick={() => {
                if (deleteDialog.test?.id) dispatch(deleteAdminTest(deleteDialog.test.id));
                setDeleteDialog({ open: false, test: null });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmActionDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Bulk Action Confirmation"
        description={`You are about to ${bulkAction === "ARCHIVE" ? "archive" : "delete"} ${selectedTests.length} tests. ${bulkPreview.valid} valid, ${bulkPreview.skipped} skipped.`}
        confirmLabel="Proceed"
        onConfirm={runBulkAction}
      />

      {bulkOpen ? (
        <div className="fixed right-6 bottom-6 z-50 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs text-slate-500">Choose bulk action</p>
          <div className="flex gap-2">
            <Button size="sm" variant={bulkAction === "ARCHIVE" ? "default" : "outline"} onClick={() => setBulkAction("ARCHIVE")}>Archive</Button>
            <Button size="sm" variant={bulkAction === "DELETE" ? "destructive" : "outline"} onClick={() => setBulkAction("DELETE")}>Delete</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
