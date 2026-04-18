import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperSettings, updateSuperSettings } from "@/features/SuperAdmin/superAdminPanelSlice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const dispatch = useDispatch();
  const settings = useSelector((state) => state.superAdminPanel.settings);
  const [form, setForm] = useState({
    maxAttemptsDefault: 1,
    defaultViolationLimit: 3,
    globalRules: "{}",
  });

  useEffect(() => {
    dispatch(fetchSuperSettings());
  }, [dispatch]);

  useEffect(() => {
    if (settings?.value) {
      setForm({
        maxAttemptsDefault: settings.value.maxAttemptsDefault ?? 1,
        defaultViolationLimit: settings.value.defaultViolationLimit ?? 3,
        globalRules: JSON.stringify(settings.value.globalRules || {}, null, 2),
      });
    }
  }, [settings]);

  const save = async () => {
    await dispatch(updateSuperSettings({
      maxAttemptsDefault: Number(form.maxAttemptsDefault),
      defaultViolationLimit: Number(form.defaultViolationLimit),
      globalRules: JSON.parse(form.globalRules || "{}"),
    }));
    dispatch(fetchSuperSettings());
  };

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader><CardTitle>Platform Settings</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <h2 className="font-bold text-2xl">this page is currrently under the development</h2>
      </CardContent>
    </Card>
  );
}
