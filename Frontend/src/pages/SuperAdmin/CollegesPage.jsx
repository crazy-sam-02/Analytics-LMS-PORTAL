import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X } from "lucide-react";
import { createSuperCollege, fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";

export default function CollegesPage() {
  const dispatch = useDispatch();
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const [form, setForm] = useState({ name: "", code: "", location: "" });
  const [pendingCollege, setPendingCollege] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [selectedCollege, setSelectedCollege] = useState(null);
  const [collegeForm, setCollegeForm] = useState({ name: "", code: "", location: "" });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchSuperColleges());
  }, [dispatch]);

  const save = async () => {
    try {
      setError(null);
      await dispatch(createSuperCollege(form));
      setForm({ name: "", code: "", location: "" });
      dispatch(fetchSuperColleges());
    } catch (err) {
      setError(err?.message || "Failed to create college");
    }
  };

  const toggleStatus = async (college, confirmationText) => {
    try {
      setIsLoading(true);
      setError(null);
      await superAdminApi.updateCollege(college.id, {
        isActive: !college.isActive,
        ...(confirmationText ? { confirmationText } : {}),
      });
      await dispatch(fetchSuperColleges());
      setPendingCollege(null);
      return true;
    } catch (err) {
      const errorMsg = err?.response?.data?.message || err?.message || "Failed to update college status";
      setError(errorMsg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const confirmToggleStatus = async () => {
    if (!pendingCollege?.id) {
      setPendingCollege(null);
      return;
    }

    await toggleStatus(pendingCollege, null);
  };

  const openCollegeModal = async (college, mode = "view") => {
    if (!college?.id) return;

    setModalMode(mode);
    setSelectedCollege(null);
    setModalLoading(true);

    try {
      setError(null);
      const details = await superAdminApi.getCollege(college.id);
      setSelectedCollege(details);
      setCollegeForm({
        name: details.name || "",
        code: details.code || "",
        location: details.location || "",
      });
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load college details");
      setModalMode(null);
    } finally {
      setModalLoading(false);
    }
  };

  const closeCollegeModal = () => {
    setModalMode(null);
    setSelectedCollege(null);
    setCollegeForm({ name: "", code: "", location: "" });
  };

  const saveCollegeChanges = async () => {
    if (!selectedCollege?.id) return;

    try {
      setModalSaving(true);
      setError(null);
      await superAdminApi.updateCollege(selectedCollege.id, {
        name: collegeForm.name.trim(),
        code: collegeForm.code.trim(),
        location: collegeForm.location.trim(),
      });

      await dispatch(fetchSuperColleges());
      const refreshed = await superAdminApi.getCollege(selectedCollege.id);
      setSelectedCollege(refreshed);
      setCollegeForm({
        name: refreshed.name || "",
        code: refreshed.code || "",
        location: refreshed.location || "",
      });
      setModalMode("view");
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to update college");
    } finally {
      setModalSaving(false);
    }
  };

  const selectedStats = selectedCollege?._count || {};

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Create College</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="College Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="College Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Button className="sm:col-span-3 bg-primary/100 hover:bg-primary" onClick={save} disabled={isLoading}>
            Create College
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Colleges</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {colleges && colleges.length > 0 ? (
            colleges.map((college) => (
              <div key={college.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                <div className="flex-1">
                  <p className="font-medium text-text-primary">
                    {college.name} ({college.code})
                    {!college.isActive && (
                      <span className="ml-2 inline-block text-xs px-2 py-1 rounded bg-danger/20 text-danger">Inactive</span>
                    )}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {college.location || "-"} • Admins: {college._count?.admins || 0} • Students: {college._count?.students || 0}
                  </p>
                </div>
                <div className="flex justify-center items-center gap-2">
                  <Button onClick={() => openCollegeModal(college, "view")} disabled={modalLoading || isLoading}>
                    View details
                  </Button>
                  <Button className="px-5" onClick={() => openCollegeModal(college, "edit")} disabled={modalLoading || isLoading}>
                    Edit
                  </Button>
                  <Button
                    variant={college.isActive ? "outline" : "default"}
                    onClick={() => setPendingCollege(college)}
                    disabled={isLoading}
                    className={!college.isActive ? "bg-primary hover:bg-primary/90" : ""}
                  >
                    {college.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-center text-text-secondary py-4">No colleges found</p>
          )}
        </CardContent>
      </Card>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-6 py-4">
              <div>
                <h3 className="text-xl font-semibold text-text-primary">
                  {modalMode === "edit" ? "Edit College" : "College Details"}
                </h3>
                <p className="text-sm text-text-secondary mt-1">
                  {selectedCollege ? `${selectedCollege.name} (${selectedCollege.code})` : "Loading college details..."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCollegeModal}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-muted hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {modalLoading && !selectedCollege ? (
              <div className="p-6 text-sm text-text-secondary">Loading college details...</div>
            ) : selectedCollege ? (
              <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-5">
                  {modalMode === "edit" ? (
                    <div className="grid gap-4">
                      <Input
                        placeholder="College Name"
                        value={collegeForm.name}
                        onChange={(e) => setCollegeForm((prev) => ({ ...prev, name: e.target.value }))}
                      />
                      <Input
                        placeholder="College Code"
                        value={collegeForm.code}
                        onChange={(e) => setCollegeForm((prev) => ({ ...prev, code: e.target.value }))}
                      />
                      <Input
                        placeholder="Location"
                        value={collegeForm.location}
                        onChange={(e) => setCollegeForm((prev) => ({ ...prev, location: e.target.value }))}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={closeCollegeModal} disabled={modalSaving}>
                          Cancel
                        </Button>
                        <Button onClick={saveCollegeChanges} disabled={modalSaving}>
                          {modalSaving ? "Saving..." : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">College Name</p>
                          <p className="mt-1 text-sm font-medium text-text-primary">{selectedCollege.name}</p>
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">College Code</p>
                          <p className="mt-1 text-sm font-medium text-text-primary">{selectedCollege.code}</p>
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">Location</p>
                          <p className="mt-1 text-sm font-medium text-text-primary">{selectedCollege.location || "-"}</p>
                        </div>
                        <div className="rounded-xl border border-border p-4">
                          <p className="text-xs uppercase tracking-wide text-text-secondary">Status</p>
                          <p className={`mt-1 text-sm font-medium ${selectedCollege.isActive ? "text-success" : "text-danger"}`}>
                            {selectedCollege.isActive ? "Active" : "Inactive"}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border p-4">
                        <p className="text-sm font-semibold text-text-primary">Operational Summary</p>
                        <p className="text-xs text-text-secondary mt-1">Counts returned by the backend college details endpoint.</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="rounded-lg bg-muted/40 p-3">
                            <p className="text-xs text-text-secondary">Departments</p>
                            <p className="text-lg font-semibold text-text-primary">{selectedStats.departments || 0}</p>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-3">
                            <p className="text-xs text-text-secondary">Admins</p>
                            <p className="text-lg font-semibold text-text-primary">{selectedStats.admins || 0}</p>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-3">
                            <p className="text-xs text-text-secondary">Students</p>
                            <p className="text-lg font-semibold text-text-primary">{selectedStats.students || 0}</p>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-3">
                            <p className="text-xs text-text-secondary">Tests</p>
                            <p className="text-lg font-semibold text-text-primary">{selectedStats.tests || 0}</p>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-3">
                            <p className="text-xs text-text-secondary">Batches</p>
                            <p className="text-lg font-semibold text-text-primary">{selectedStats.batches || 0}</p>
                          </div>
                          <div className="rounded-lg bg-muted/40 p-3">
                            <p className="text-xs text-text-secondary">Question Bank</p>
                            <p className="text-lg font-semibold text-text-primary">{selectedStats.questionBankItems || 0}</p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {modalMode === "view" && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-sm font-semibold text-text-primary">Record Details</p>
                      <dl className="mt-3 space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-secondary">Created</dt>
                          <dd className="text-text-primary">{selectedCollege.createdAt ? new Date(selectedCollege.createdAt).toLocaleString() : "-"}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-secondary">Updated</dt>
                          <dd className="text-text-primary">{selectedCollege.updatedAt ? new Date(selectedCollege.updatedAt).toLocaleString() : "-"}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-secondary">Deleted</dt>
                          <dd className="text-text-primary">{selectedCollege.deletedAt ? new Date(selectedCollege.deletedAt).toLocaleString() : "-"}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="flex flex-wrap justify-end gap-3">
                      <Button variant="outline" onClick={closeCollegeModal}>Close</Button>
                      <Button onClick={() => setModalMode("edit")}>Edit College</Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={Boolean(pendingCollege && !pendingCollege.isActive)}
        onOpenChange={(open) => !open && setPendingCollege(null)}
        title="Activate College"
        description={`Activate ${pendingCollege?.name || "this college"}? Its admins and students will be able to access the platform.`}
        confirmLabel="Activate"
        confirmVariant="default"
        onConfirm={confirmToggleStatus}
      />

      <TypedConfirmDialog
        open={Boolean(pendingCollege && pendingCollege.isActive)}
        onOpenChange={(open) => !open && setPendingCollege(null)}
        title="Deactivate College"
        description={`Deactivating ${pendingCollege?.name || "this college"} will restrict admin and student access to the platform.`}
        expectedText={`SUSPEND ${pendingCollege?.code || pendingCollege?.id || ""}`}
        inputLabel="Type the phrase to confirm"
        confirmLabel="Deactivate College"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingCollege) {
            await toggleStatus(pendingCollege, typedText);
          }
        }}
      />
    </div>
  );
}
