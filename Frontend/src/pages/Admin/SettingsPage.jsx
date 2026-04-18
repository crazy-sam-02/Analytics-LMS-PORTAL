import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import SkeletonBlock from "@/components/common/SkeletonBlock";

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });

  const settingsQuery = useQuery({
    queryKey: ["admin-settings"],
    queryFn: adminApi.getSettings,
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setSettingsDraft(settingsQuery.data.settings);
    }
  }, [settingsQuery.data]);

  const updateMutation = useMutation({
    mutationFn: adminApi.updateSettings,
    onSuccess: () => {
      toast.success("Settings updated.");
      setBanner({ type: "success", title: "Settings saved", message: "Default test and college settings were updated." });
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Save failed", message: error?.message || "Unable to update settings." });
      toast.error(error?.message || "Failed to update settings.");
    },
  });

  const passwordMutation = useMutation({
    mutationFn: adminApi.changePassword,
    onSuccess: () => {
      toast.success("Password changed.");
      setBanner({ type: "success", title: "Password updated", message: "Your admin password has been changed." });
      setPasswordForm({ currentPassword: "", newPassword: "" });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Password change failed", message: error?.message || "Could not update password." });
      toast.error(error?.message || "Failed to change password.");
    },
  });

  const profile = settingsQuery.data?.profile;

  const passwordError = (() => {
    if (!passwordForm.currentPassword && !passwordForm.newPassword) return "";
    if (passwordForm.newPassword.length < 8) return "New password must be at least 8 characters.";
    if (passwordForm.newPassword === passwordForm.currentPassword) return "New password must differ from current password.";
    return "";
  })();

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      {settingsQuery.isLoading ? (
        <Card className="rounded-2xl border-slate-200">
          <CardContent className="space-y-3 p-6">
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-12" />
            <SkeletonBlock className="h-12" />
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Admin Profile</CardTitle>
          <CardDescription>Read-only identity context used for scoped access and audit trails.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <p className="text-sm text-slate-700"><span className="font-semibold">Name:</span> {profile?.fullName || "-"}</p>
          <p className="text-sm text-slate-700"><span className="font-semibold">Email:</span> {profile?.email || "-"}</p>
          <p className="text-sm text-slate-700"><span className="font-semibold">Employee ID:</span> {profile?.employeeId || "-"}</p>
          <p className="text-sm text-slate-700"><span className="font-semibold">Role:</span> {profile?.role || "-"}</p>
          <p className="text-sm text-slate-700"><span className="font-semibold">College:</span> {profile?.college?.name || "-"}</p>
          <p className="text-sm text-slate-700"><span className="font-semibold">Department:</span> {profile?.department?.name || "-"}</p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Default Test Configuration</CardTitle>
          <CardDescription>Applied as baseline for new tests in this college.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Input
            type="number"
            placeholder="Duration (mins)"
            value={settingsDraft?.defaultTestConfig?.durationMins ?? ""}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              defaultTestConfig: { ...prev.defaultTestConfig, durationMins: Number(event.target.value) },
            }))}
          />
          <Input
            type="number"
            placeholder="Attempts allowed"
            value={settingsDraft?.defaultTestConfig?.attemptsAllowed ?? ""}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              defaultTestConfig: { ...prev.defaultTestConfig, attemptsAllowed: Number(event.target.value) },
            }))}
          />
          <Input
            type="number"
            placeholder="Violation threshold"
            value={settingsDraft?.defaultTestConfig?.violationThreshold ?? ""}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              defaultTestConfig: { ...prev.defaultTestConfig, violationThreshold: Number(event.target.value) },
            }))}
          />
          <select
            className="h-10 rounded-md border border-slate-200 px-3 text-sm"
            value={settingsDraft?.defaultTestConfig?.evaluationRule || "BEST_ATTEMPT"}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              defaultTestConfig: { ...prev.defaultTestConfig, evaluationRule: event.target.value },
            }))}
          >
            <option value="BEST_ATTEMPT">Best Attempt</option>
            <option value="LATEST_ATTEMPT">Latest Attempt</option>
            <option value="AVERAGE">Average</option>
          </select>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>College Settings</CardTitle>
          <CardDescription>Administrative defaults for archive policy and reporting retention.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(settingsDraft?.collegeSettings?.allowBatchArchive)}
              onChange={(event) => setSettingsDraft((prev) => ({
                ...prev,
                collegeSettings: { ...prev.collegeSettings, allowBatchArchive: event.target.checked },
              }))}
            />
            Allow Batch Archive
          </label>
          <select
            className="h-10 rounded-md border border-slate-200 px-3 text-sm"
            value={settingsDraft?.collegeSettings?.registrationPolicy || "OPEN"}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              collegeSettings: { ...prev.collegeSettings, registrationPolicy: event.target.value },
            }))}
          >
            <option value="OPEN">OPEN</option>
            <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
          <Input
            type="number"
            placeholder="Report retention days"
            value={settingsDraft?.collegeSettings?.reportRetentionDays ?? ""}
            onChange={(event) => setSettingsDraft((prev) => ({
              ...prev,
              collegeSettings: { ...prev.collegeSettings, reportRetentionDays: Number(event.target.value) },
            }))}
          />
          <Button className="sm:col-span-3" onClick={() => updateMutation.mutate(settingsDraft)} disabled={!settingsDraft || updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Password updates are immediately audited.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input
            type="password"
            placeholder="Current password"
            value={passwordForm.currentPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
          />
          <Input
            type="password"
            placeholder="New password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
          />
          <Button onClick={() => passwordMutation.mutate(passwordForm)} disabled={!passwordForm.currentPassword || !passwordForm.newPassword || Boolean(passwordError) || passwordMutation.isPending}>
            {passwordMutation.isPending ? "Updating..." : "Update Password"}
          </Button>
          {passwordError ? <p className="sm:col-span-3 text-xs text-red-600">{passwordError}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
