import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setTheme } from "@/features/Students/uiSlice";
import { studentApi } from "@/services/studentApi";
import { ui } from "@/styles/ui-tokens";

export default function SettingsPage() {
  const dispatch = useDispatch();
  const selectedTheme = useSelector((state) => state.ui.theme || "system");

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [inlineError, setInlineError] = useState("");

  useEffect(() => {
    const root = document.documentElement;

    if (selectedTheme === "dark") {
      root.classList.add("dark");
      root.dataset.theme = "dark";
      return;
    }

    if (selectedTheme === "light") {
      root.classList.remove("dark");
      root.dataset.theme = "light";
      return;
    }

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
    root.dataset.theme = "system";
  }, [selectedTheme]);

  const passwordValidationError = useMemo(() => {
    if (!passwordForm.currentPassword && !passwordForm.newPassword && !passwordForm.confirmPassword) {
      return "";
    }

    if (passwordForm.newPassword.length < 8) {
      return "New password must be at least 8 characters.";
    }

    if (passwordForm.newPassword === passwordForm.currentPassword) {
      return "New password must be different from current password.";
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return "Password confirmation does not match.";
    }

    return "";
  }, [passwordForm]);

  const updatePasswordMutation = useMutation({
    mutationFn: () =>
      studentApi.changeMyPassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      }),
    onSuccess: () => {
      setInlineError("");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success("Password updated successfully.");
    },
    onError: (error) => {
      if (error?.code === "WRONG_CURRENT_PASSWORD") {
        setInlineError("Current password is incorrect.");
        return;
      }
      setInlineError("");
      toast.error(error?.message || "Unable to update password.");
    },
  });

  const updatePassword = () => {
    setInlineError("");
    if (passwordValidationError) {
      setInlineError(passwordValidationError);
      return;
    }

    updatePasswordMutation.mutate();
  };

  return (
    <section className="grid gap-5 lg:grid-cols-1 xl:grid-cols-2">
      <article className={`${ui.card} ${ui.cardPadding}`}>
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-blue-100 text-[#0569c9]"><LockKeyhole className="size-4" /></div>
          <h2 className="text-lg font-semibold text-slate-900">Change Password</h2>
        </div>

        <div className="grid gap-3">
          <Input
            type="password"
            className="rounded-xl border border-slate-200 bg-[#f8fafd] px-3 py-2.5"
            placeholder="Current password"
            value={passwordForm.currentPassword}
            onChange={(event) =>
              setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
            }
          />
          <Input
            type="password"
            className="rounded-xl border border-slate-200 bg-[#f8fafd] px-3 py-2.5"
            placeholder="New password"
            value={passwordForm.newPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
          />
          <Input
            type="password"
            className="rounded-xl border border-slate-200 bg-[#f8fafd] px-3 py-2.5"
            placeholder="Confirm new password"
            value={passwordForm.confirmPassword}
            onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
          />
          {inlineError ? <p className="text-sm text-red-600">{inlineError}</p> : null}
          <Button onClick={updatePassword} className="h-10 rounded-xl bg-[#0569c9] px-4 text-sm font-semibold shadow-md shadow-blue-700/20 hover:bg-[#0659a8]">
            {updatePasswordMutation.isPending ? "Updating..." : "Update Password"}
          </Button>
        </div>

        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-3.5" /> Security Notice</div>
          <p className="mt-1 text-blue-700">Use at least 8 characters with one number and one special character.</p>
        </div>
      </article>

      <article className={`${ui.card} ${ui.cardPadding}`}>
        <div className="mb-4 flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-violet-100 text-violet-600"><SlidersHorizontal className="size-4" /></div>
          <h2 className="text-lg font-semibold text-slate-900">Theme</h2>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-[#f8fafd] p-3">
          <p className="text-sm text-slate-600">Choose how the LMS should render colors for your workspace.</p>
          <Select value={selectedTheme} onValueChange={(value) => dispatch(setTheme(value))}>
            <SelectTrigger className="w-full bg-white">
              <SelectValue placeholder="Select theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </article>
    </section>
  );
}
