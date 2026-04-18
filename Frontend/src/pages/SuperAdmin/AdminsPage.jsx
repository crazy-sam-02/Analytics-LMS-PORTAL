import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { createSuperAdminUser, fetchSuperAdmins, fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";

const loadXlsxBrowserLib = () =>
  new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.XLSX) {
      resolve(window.XLSX);
      return;
    }

    const existing = document.querySelector('script[data-xlsx-loader="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.XLSX));
      existing.addEventListener("error", () => reject(new Error("Unable to load spreadsheet parser")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.async = true;
    script.dataset.xlsxLoader = "true";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Unable to load spreadsheet parser"));
    document.head.appendChild(script);
  });

const IMPORT_SAMPLE = [
  "fullName,email,employeeId,collegeCode,password,department",
  "John Doe,john.doe@example.com,EMP1001,NVC,Admin@12345,Computer Science",
].join("\n");

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value ?? "").trim();
    }
  }
  return "";
};

export default function AdminsPage() {
  const dispatch = useDispatch();
  const admins = useSelector((state) => state.superAdminPanel.admins);
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const [form, setForm] = useState({ fullName: "", email: "", employeeId: "", password: "", collegeId: "" });
  const [pendingAction, setPendingAction] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importCsv, setImportCsv] = useState(IMPORT_SAMPLE);
  const [importDefaultCollegeId, setImportDefaultCollegeId] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    dispatch(fetchSuperAdmins());
    dispatch(fetchSuperColleges());
  }, [dispatch]);

  const save = async () => {
    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      employeeId: form.employeeId.trim(),
      password: form.password,
      collegeId: form.collegeId,
    };

    if (!payload.fullName || !payload.email || !payload.employeeId || !payload.password || !payload.collegeId) {
      toast.error("Please fill all required fields before creating admin.");
      return;
    }

    if (payload.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    try {
      setIsSubmitting(true);
      await dispatch(createSuperAdminUser(payload)).unwrap();
      toast.success("Admin created successfully.");
      setForm({ fullName: "", email: "", employeeId: "", password: "", collegeId: "" });
      dispatch(fetchSuperAdmins());
    } catch (error) {
      toast.error(error?.message || "Unable to create admin.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deactivate = async (adminId, confirmationText) => {
    await superAdminApi.deactivateAdmin(adminId, { confirmationText });
    dispatch(fetchSuperAdmins());
  };

  const resetPassword = async (adminId) => {
    await superAdminApi.resetAdminPassword(adminId, { password: "Admin@12345" });
    dispatch(fetchSuperAdmins());
  };

  const openResetConfirm = (admin) => {
    setPendingAction({
      type: "reset",
      admin,
      title: "Reset Admin Password",
      description: `Reset password for ${admin.fullName} to the default temporary password Admin@12345?`,
      confirmLabel: "Reset Password",
      confirmVariant: "outline",
    });
  };

  const openDeactivateConfirm = (admin) => {
    setPendingAction({
      type: "deactivate",
      admin,
      title: "Deactivate Admin",
      description: `Deactivate ${admin.fullName}? They will lose admin access immediately.`,
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction?.admin?.id) {
      setPendingAction(null);
      return;
    }

    if (pendingAction.type === "reset") {
      await resetPassword(pendingAction.admin.id);
    }

    setPendingAction(null);
  };

  const toCell = (value) => String(value ?? "").replace(/,/g, " ").trim();

  const rowsToCsv = (rows) => {
    const header = ["fullName", "email", "employeeId", "password", "collegeId", "collegeCode", "collegeName", "department"];
    const lines = rows.map((row) => {
      const normalized = {
        fullName: getRowValue(row, ["fullName", "fullname", "name", "adminName"]),
        email: getRowValue(row, ["email", "emailAddress"]),
        employeeId: getRowValue(row, ["employeeId", "employee_id", "staffId", "staff_id"]),
        password: getRowValue(row, ["password"]),
        collegeId: getRowValue(row, ["collegeId", "college_id"]),
        collegeCode: getRowValue(row, ["collegeCode", "college_code", "code"]),
        collegeName: getRowValue(row, ["collegeName", "college_name", "college"]),
        department: getRowValue(row, ["department", "departmentName", "department_id", "departmentId"]),
      };

      return [
        toCell(normalized.fullName),
        toCell(normalized.email),
        toCell(normalized.employeeId),
        toCell(normalized.password),
        toCell(normalized.collegeId),
        toCell(normalized.collegeCode),
        toCell(normalized.collegeName),
        toCell(normalized.department),
      ].join(",");
    });

    return [header.join(","), ...lines].join("\n");
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const name = String(file.name || "").toLowerCase();
      let parsedCsv = "";

      if (name.endsWith(".csv")) {
        parsedCsv = await file.text();
      } else {
        const XLSX = await loadXlsxBrowserLib();
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error("Selected file has no rows");
        }

        parsedCsv = rowsToCsv(rows);
      }

      setImportCsv(parsedCsv);
      setImportFileName(file.name);
      toast.success("Admin import file loaded");
    } catch (error) {
      toast.error(error?.message || "Unable to parse spreadsheet file");
    }

    event.target.value = "";
  };

  const startBulkImport = async () => {
    if (!importCsv.trim()) {
      toast.error("CSV data is required for import.");
      return;
    }

    try {
      setIsImporting(true);
      const payload = await superAdminApi.bulkImportAdmins({
        csvData: importCsv,
        ...(importDefaultCollegeId ? { defaultCollegeId: importDefaultCollegeId } : {}),
      });
      setImportResult(payload?.result || null);
      toast.success("Admin import completed");
      dispatch(fetchSuperAdmins());
    } catch (error) {
      toast.error(error?.message || "Admin import failed");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Create Admin</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="Full Name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Employee ID" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
          <Input placeholder="Password" value={form.password} type="password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="h-8 rounded-lg border border-slate-200 px-2" value={form.collegeId} onChange={(e) => setForm({ ...form, collegeId: e.target.value })}>
            <option value="">Select college</option>
            {colleges.filter((college) => college?.isActive !== false).map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <Button className="sm:col-span-3 bg-blue-500 hover:bg-blue-600" onClick={save} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Admin"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Bulk Import Admins</CardTitle>
          <CardDescription>Upload Excel/CSV and map each admin to a college by collegeId, collegeCode, or collegeName.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              className="h-10 rounded-lg border border-slate-200 px-2"
              value={importDefaultCollegeId}
              onChange={(event) => setImportDefaultCollegeId(event.target.value)}
            >
              <option value="">Default college (optional)</option>
              {colleges.filter((college) => college?.isActive !== false).map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleImportFile} />
            <Button variant="outline" onClick={() => { setImportCsv(IMPORT_SAMPLE); setImportFileName(""); setImportResult(null); }}>
              Reset Sample
            </Button>
          </div>

          <p className="text-xs text-slate-500">
            Required columns: fullName, email, employeeId. Optional: password, department, collegeId, collegeCode, collegeName.
            {importFileName ? ` Loaded file: ${importFileName}` : ""}
          </p>

          <Textarea
            className="min-h-45 font-mono text-xs"
            value={importCsv}
            onChange={(event) => setImportCsv(event.target.value)}
          />

          <Button className="bg-blue-500 hover:bg-blue-600" onClick={startBulkImport} disabled={isImporting}>
            {isImporting ? "Importing..." : "Start Import"}
          </Button>

          {importResult ? (
            <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
              <p>Created: {importResult.created || 0}</p>
              <p>Duplicates: {importResult.duplicates || 0}</p>
              <p>Failed: {importResult.failed || 0}</p>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Latest errors: {importResult.errors.slice(0, 5).map((item) => `Row ${item.row}: ${item.reason}`).join(" | ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Admins</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {admins.map((admin) => (
            <div key={admin.id} className="flex flex-wrap items-center justify-between rounded-xl border border-slate-200 px-3 py-2 gap-2">
              <div>
                <p className="font-medium text-slate-800">{admin.fullName}</p>
                <p className="text-xs text-slate-500">{admin.email} • {admin.employeeId} • {admin.college?.name}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openResetConfirm(admin)}>Reset Password</Button>
                <Button size="sm" variant="outline" onClick={() => openDeactivateConfirm(admin)} disabled={!admin.isActive}>{admin.isActive ? "Deactivate" : "Disabled"}</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={Boolean(pendingAction && pendingAction.type === "reset")}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction?.title || "Confirm Action"}
        description={pendingAction?.description || "Please confirm this action."}
        confirmLabel={pendingAction?.confirmLabel || "Confirm"}
        confirmVariant={pendingAction?.confirmVariant || "default"}
        onConfirm={confirmPendingAction}
      />

      <TypedConfirmDialog
        open={Boolean(pendingAction && pendingAction.type === "deactivate")}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Typed Confirmation Required"
        description={`This will immediately disable ${pendingAction?.admin?.fullName || "this admin"}. Type the confirmation text to proceed.`}
        expectedText={`DEACTIVATE ${pendingAction?.admin?.employeeId || pendingAction?.admin?.id || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Deactivate"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingAction?.admin?.id) {
            await deactivate(pendingAction.admin.id, typedText);
          }
          setPendingAction(null);
        }}
      />
    </div>
  );
}
