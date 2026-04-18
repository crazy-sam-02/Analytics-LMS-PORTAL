import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperColleges, fetchSuperStudents } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  "fullName,email,enrollNumber,department,batch",
  "Alice Doe,alice@example.com,20261001,Computer Science,CSE-2027-A",
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

export default function StudentsPage() {
  const dispatch = useDispatch();
  const students = useSelector((state) => state.superAdminPanel.students);
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const [filters, setFilters] = useState({ search: "", collegeId: "", departmentId: "", batchId: "" });
  const [pendingBlock, setPendingBlock] = useState(null);
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [activeImportJobId, setActiveImportJobId] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [csvData, setCsvData] = useState(IMPORT_SAMPLE);
  const [studentForm, setStudentForm] = useState({
    fullName: "",
    email: "",
    enrollNumber: "",
    collegeId: "",
    departmentId: "",
    batchId: "",
  });
  const [createdCredentials, setCreatedCredentials] = useState(null);

  useEffect(() => {
    dispatch(fetchSuperStudents());
    dispatch(fetchSuperColleges());
  }, [dispatch]);

  const departmentsQuery = useQuery({
    queryKey: ["super-student-departments", studentForm.collegeId || filters.collegeId],
    queryFn: () => {
      const sourceCollegeId = studentForm.collegeId || filters.collegeId;
      const params = sourceCollegeId ? `?collegeId=${encodeURIComponent(sourceCollegeId)}&limit=100` : "?limit=100";
      return superAdminApi.getDepartments(params);
    },
  });

  const batchesQuery = useQuery({
    queryKey: ["super-student-batches", studentForm.collegeId || filters.collegeId],
    queryFn: () => {
      const sourceCollegeId = studentForm.collegeId || filters.collegeId;
      const params = sourceCollegeId ? `?collegeId=${encodeURIComponent(sourceCollegeId)}&limit=100` : "?limit=100";
      return superAdminApi.getBatches(params);
    },
  });

  const importJobQuery = useQuery({
    queryKey: ["super-student-import-job", activeImportJobId],
    queryFn: () => superAdminApi.getStudentImportJobStatus(activeImportJobId),
    enabled: Boolean(activeImportJobId),
    refetchInterval: (query) => {
      const status = query?.state?.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const toCell = (value) => String(value ?? "").replace(/,/g, " ").trim();

  const rowsToCsv = (rows) => {
    const header = ["fullName", "email", "studentId", "enrollNumber", "department", "batch"];
    const lines = rows.map((row) => {
      const normalized = {
        fullName: getRowValue(row, ["fullName", "fullname", "name", "studentName"]),
        email: getRowValue(row, ["email", "emailAddress"]),
        studentId: getRowValue(row, ["studentId", "student_id", "rollNo", "rollNumber"]),
        enrollNumber: getRowValue(row, ["enrollNumber", "enroll_number", "enrollmentNumber", "enrollment_no"]),
        department: getRowValue(row, ["department", "departmentName", "departmentId", "department_id"]),
        batch: getRowValue(row, ["batch", "batchName", "batchId", "batch_id"]),
      };
      return [
        toCell(normalized.fullName),
        toCell(normalized.email),
        toCell(normalized.studentId),
        toCell(normalized.enrollNumber),
        toCell(normalized.department),
        toCell(normalized.batch),
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

      setCsvData(parsedCsv);
      setImportFileName(file.name);
      setBanner({ type: "success", title: "File loaded", message: "Spreadsheet parsed successfully. Review rows and start import." });
    } catch (error) {
      setBanner({ type: "error", title: "File parse failed", message: error?.message || "Unable to parse spreadsheet file." });
      toast.error(error?.message || "Unable to parse spreadsheet file");
    }

    event.target.value = "";
  };

  const runSearch = () => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.collegeId.trim()) params.set("collegeId", filters.collegeId.trim());
    if (filters.departmentId.trim()) params.set("departmentId", filters.departmentId.trim());
    if (filters.batchId.trim()) params.set("batchId", filters.batchId.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    dispatch(fetchSuperStudents(query));
  };

  const createStudentMutation = useMutation({
    mutationFn: (payload) => superAdminApi.createStudent(payload),
    onSuccess: (payload) => {
      setCreatedCredentials(payload.credentials || null);
      setStudentForm({ fullName: "", email: "", enrollNumber: "", collegeId: "", departmentId: "", batchId: "" });
      setBanner({ type: "success", title: "Student created", message: "Student account created with generated credentials." });
      toast.success("Student account created");
      runSearch();
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Create student failed", message: error?.message || "Unable to create student account." });
      toast.error(error?.message || "Unable to create student account");
    },
  });

  const importMutation = useMutation({
    mutationFn: (payload) => superAdminApi.bulkImportStudents(payload),
    onSuccess: (payload) => {
      setActiveImportJobId(payload.jobId);
      setBanner({ type: "success", title: "Import queued", message: "CSV processing started in background." });
      toast.success("Import job queued");
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Import queue failed", message: error?.message || "Unable to queue import job." });
      toast.error(error?.message || "Unable to queue import job");
    },
  });

  const toggleStatus = async (student, confirmationText = null) => {
    await superAdminApi.updateStudentStatus(student.id, {
      isActive: !student.isActive,
      ...(confirmationText ? { confirmationText } : {}),
    });
    runSearch();
  };

  useEffect(() => {
    if (!importJobQuery.data) return;

    if (importJobQuery.data.status === "completed") {
      setBanner({ type: "success", title: "Import completed", message: "Refresh student list to review newly created accounts." });
      runSearch();
      return;
    }

    if (importJobQuery.data.status === "failed") {
      setBanner({ type: "error", title: "Import failed", message: importJobQuery.data.error || "Import job failed during processing." });
      return;
    }

    if (importJobQuery.data.status === "queued" || importJobQuery.data.status === "processing") {
      setBanner({ type: "warning", title: "Import in progress", message: "Job is still running. Results will appear shortly." });
    }
  }, [importJobQuery.data]);

  const departments = useMemo(() => departmentsQuery.data?.data || [], [departmentsQuery.data]);
  const batches = useMemo(() => batchesQuery.data?.data || [], [batchesQuery.data]);
  const filteredBatches = useMemo(() => {
    if (!studentForm.departmentId) return batches;
    return batches.filter((batch) => String(batch.departmentId) === String(studentForm.departmentId));
  }, [batches, studentForm.departmentId]);

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
          <CardTitle>Create Student Account</CardTitle>
          <CardDescription>Super Admin can create student accounts manually across colleges.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Full name"
              value={studentForm.fullName}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, fullName: event.target.value }))}
            />
            <Input
              type="email"
              placeholder="Email"
              value={studentForm.email}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            <Input
              placeholder="Enroll number"
              value={studentForm.enrollNumber}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, enrollNumber: event.target.value }))}
            />
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={studentForm.collegeId}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, collegeId: event.target.value, departmentId: "", batchId: "" }))}
            >
              <option value="">Select college</option>
              {colleges.filter((college) => college?.isActive !== false).map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={studentForm.departmentId}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, departmentId: event.target.value, batchId: "" }))}
            >
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={studentForm.batchId}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, batchId: event.target.value }))}
            >
              <option value="">Select batch (optional)</option>
              {filteredBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.name}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-slate-500">Student ID is auto-generated. Password rule: first 3 letters of full name (first letter capitalized) + @ + last 3 digits of enroll number.</p>
          <Button
            onClick={() => createStudentMutation.mutate({
              fullName: studentForm.fullName,
              email: studentForm.email,
              enrollNumber: studentForm.enrollNumber,
              collegeId: studentForm.collegeId,
              departmentId: studentForm.departmentId,
              ...(studentForm.batchId ? { batchId: studentForm.batchId } : {}),
            })}
            disabled={
              createStudentMutation.isPending ||
              !studentForm.fullName.trim() ||
              !studentForm.email.trim() ||
              !studentForm.enrollNumber.trim() ||
              !studentForm.collegeId ||
              !studentForm.departmentId
            }
          >
            {createStudentMutation.isPending ? "Creating..." : "Create Student"}
          </Button>

          {createdCredentials ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-semibold">Student credentials</p>
              <p>Email: {createdCredentials.identifier}</p>
              <p>Student ID: {createdCredentials.studentId}</p>
              <p>Password: {createdCredentials.password}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Bulk Import (Excel/CSV)</CardTitle>
          <CardDescription>Upload .xlsx/.xls/.csv file or paste CSV for the selected college.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={filters.collegeId}
              onChange={(event) => setFilters((prev) => ({ ...prev, collegeId: event.target.value }))}
            >
              <option value="">Select target college</option>
              {colleges.filter((college) => college?.isActive !== false).map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
          </div>

          {importFileName ? <p className="text-xs text-slate-500">Loaded: {importFileName}</p> : null}
          <p className="text-xs text-slate-500">Required columns: fullName, email, enrollNumber, department. Optional: studentId, batch.</p>

          <Textarea rows={8} value={csvData} onChange={(event) => setCsvData(event.target.value)} />

          <div className="flex items-center gap-2">
            <Button
              onClick={() => importMutation.mutate({ csvData, collegeId: filters.collegeId })}
              disabled={importMutation.isPending || !filters.collegeId || !csvData.trim()}
            >
              {importMutation.isPending ? "Queueing..." : "Start Import"}
            </Button>
            {activeImportJobId ? <p className="text-xs text-slate-500">Job: {activeImportJobId}</p> : null}
          </div>

          {importJobQuery.data ? (
            <div className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-medium text-slate-800">Status: {String(importJobQuery.data.status || "unknown").toUpperCase()}</p>
              {importJobQuery.data.result ? (
                <>
                  <p className="mt-1 text-slate-600">
                    Created: {importJobQuery.data.result.created || 0} • Failed: {importJobQuery.data.result.failed || 0} • Duplicates: {importJobQuery.data.result.duplicates || 0}
                  </p>
                  {Array.isArray(importJobQuery.data.result.errors) && importJobQuery.data.result.errors.length > 0 ? (
                    <div className="mt-2 max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                      {importJobQuery.data.result.errors.slice(0, 10).map((item, index) => (
                        <p key={`${item.row || "row"}-${index}`}>Row {item.row || "?"}: {item.reason || "Invalid data"}</p>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {importJobQuery.data.error ? <p className="mt-1 text-red-600">Error: {importJobQuery.data.error}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Global Students</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-2 sm:grid-cols-5">
            <Input placeholder="Search" value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} />
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={filters.collegeId} onChange={(e) => setFilters((prev) => ({ ...prev, collegeId: e.target.value }))}>
              <option value="">All colleges</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
            <Input placeholder="Department ID" value={filters.departmentId} onChange={(e) => setFilters((prev) => ({ ...prev, departmentId: e.target.value }))} />
            <Input placeholder="Batch ID" value={filters.batchId} onChange={(e) => setFilters((prev) => ({ ...prev, batchId: e.target.value }))} />
            <Button variant="outline" onClick={runSearch}>Search</Button>
          </div>
          <div className="space-y-2">
            {students.map((student) => (
              <div key={student.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                <div>
                  <p className="font-medium text-slate-800">{student.fullName}</p>
                  <p className="text-xs text-slate-500">{student.email} • {student.studentId} • {student.college?.name}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  if (student.isActive) {
                    setPendingBlock(student);
                    return;
                  }
                  toggleStatus(student);
                }}>
                  {student.isActive ? "Block" : "Unblock"}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <TypedConfirmDialog
        open={Boolean(pendingBlock)}
        onOpenChange={(open) => !open && setPendingBlock(null)}
        title="Typed Confirmation Required"
        description={`Blocking ${pendingBlock?.fullName || "this student"} will prevent login until unblocked.`}
        expectedText={`BLOCK ${pendingBlock?.studentId || pendingBlock?.id || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Block Student"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingBlock) {
            await toggleStatus(pendingBlock, typedText);
          }
          setPendingBlock(null);
        }}
      />
    </div>
  );
}
