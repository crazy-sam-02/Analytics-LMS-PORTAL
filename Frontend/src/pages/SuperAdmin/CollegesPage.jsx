import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
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

  useEffect(() => {
    dispatch(fetchSuperColleges());
  }, [dispatch]);

  const save = async () => {
    await dispatch(createSuperCollege(form));
    setForm({ name: "", code: "", location: "" });
    dispatch(fetchSuperColleges());
  };

  const toggleStatus = async (college, confirmationText) => {
    await superAdminApi.updateCollege(college.id, {
      isActive: !college.isActive,
      ...(confirmationText ? { confirmationText } : {}),
    });
    dispatch(fetchSuperColleges());
  };

  const confirmToggleStatus = async () => {
    if (!pendingCollege?.id) {
      setPendingCollege(null);
      return;
    }

    await toggleStatus(pendingCollege, null);
    setPendingCollege(null);
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Create College</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="College Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="College Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Button className="sm:col-span-3 bg-blue-500 hover:bg-blue-600" onClick={save}>Create College</Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Colleges</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {colleges.map((college) => (
            <div key={college.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
              <div>
                <p className="font-medium text-slate-800">{college.name} ({college.code})</p>
                <p className="text-xs text-slate-500">{college.location || "-"} • Admins: {college._count?.admins || 0} • Students: {college._count?.students || 0}</p>
              </div>
              <Button variant="outline" onClick={() => setPendingCollege(college)}>
                {college.isActive ? "Deactivate" : "Activate"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={Boolean(pendingCollege && !pendingCollege.isActive)}
        onOpenChange={(open) => !open && setPendingCollege(null)}
        title={pendingCollege?.isActive ? "Deactivate College" : "Activate College"}
        description={
          pendingCollege?.isActive
            ? `Deactivate ${pendingCollege?.name || "this college"}? Admin and student access will be restricted.`
            : `Activate ${pendingCollege?.name || "this college"}? Its admins and students can access the platform again.`
        }
        confirmLabel={pendingCollege?.isActive ? "Deactivate" : "Activate"}
        confirmVariant={pendingCollege?.isActive ? "destructive" : "default"}
        onConfirm={confirmToggleStatus}
      />

      <TypedConfirmDialog
        open={Boolean(pendingCollege && pendingCollege.isActive)}
        onOpenChange={(open) => !open && setPendingCollege(null)}
        title="Typed Confirmation Required"
        description={`Suspending ${pendingCollege?.name || "this college"} will restrict admin and student access.`}
        expectedText={`SUSPEND ${pendingCollege?.code || pendingCollege?.id || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Suspend College"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingCollege) {
            await toggleStatus(pendingCollege, typedText);
          }
          setPendingCollege(null);
        }}
      />
    </div>
  );
}
