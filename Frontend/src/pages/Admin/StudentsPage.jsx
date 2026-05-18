import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SkeletonBlock from "@/components/common/SkeletonBlock";

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

export default function StudentsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [directoryFilters, setDirectoryFilters] = useState({ departmentId: "", batchId: "" });
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [batchIdInput, setBatchIdInput] = useState("");
  const [csvData, setCsvData] = useState(IMPORT_SAMPLE);
  const [activeImportJobId, setActiveImportJobId] = useState("");
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [importFileName, setImportFileName] = useState("");
  const [studentForm, setStudentForm] = useState({
    fullName: "",
    email: "",
    department: "",
    enrollNumber: "",
    batch: "",
  });
  const [createdCredentials, setCreatedCredentials] = useState(null);

  const toCell = (value) => String(value ?? "").replace(/,/g, " ").trim();

  const rowsToCsv = (rows) => {
    const header = ["fullName", "email", "studentId", "enrollNumber", "department", "batch"];
    const lines = rows.map((row) => {
      const normalized = {
        fullName: row.fullName ?? row.fullname ?? row.name ?? "",
        email: row.email ?? "",
        studentId: row.studentId ?? row.studentid ?? row.student_id ?? "",
        enrollNumber: row.enrollNumber ?? row.enrollnumber ?? row.enroll_number ?? "",
        department: row.department ?? row.departmentName ?? row.departmentname ?? "",
        batch: row.batch ?? row.batchName ?? row.batchname ?? "",
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

  const studentsQuery = useQuery({
    queryKey: ["admin-students", search, page, directoryFilters.departmentId, directoryFilters.batchId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      params.set("page", String(page));
      if (search.trim()) params.set("search", search.trim());
      if (directoryFilters.departmentId) params.set("departmentId", directoryFilters.departmentId);
      if (directoryFilters.batchId) params.set("batchId", directoryFilters.batchId);
      return adminApi.getStudents(`?${params.toString()}`);
    },
  });

  const studentProfileQuery = useQuery({
    queryKey: ["admin-student-profile", selectedStudentId],
    queryFn: () => adminApi.getStudentProfile(selectedStudentId),
    enabled: Boolean(selectedStudentId),
  });

  const batchesQuery = useQuery({
    queryKey: ["admin-batches-for-students"],
    queryFn: adminApi.getBatches,
  });

  const departmentsQuery = useQuery({
    queryKey: ["admin-departments-for-students"],
    queryFn: adminApi.getDepartments,
  });

  const assignBatchMutation = useMutation({
    mutationFn: ({ studentId, batchId }) => adminApi.assignStudentBatch(studentId, { batchId }),
    onSuccess: () => {
      toast.success("Batch assigned.");
      setBanner({ type: "success", title: "Batch updated", message: "Student has been added to the selected batch." });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      queryClient.invalidateQueries({ queryKey: ["admin-student-profile", selectedStudentId] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Assign failed", message: error?.message || "Could not assign student to this batch." });
      toast.error(error?.message || "Failed to assign batch.");
    },
  });

  const importMutation = useMutation({
    mutationFn: (body) => adminApi.bulkImportStudents(body),
    onSuccess: (payload) => {
      // Handle both queued async job (legacy) and immediate report (new behavior)
      if (payload && payload.jobId) {
        toast.success("Import job queued.");
        setBanner({ type: "success", title: "Import queued", message: "CSV processing started in background." });
        setActiveImportJobId(payload.jobId);
        return;
      }

      // Immediate report returned
      const report = payload?.result || payload || {};
      const created = report.created || 0;
      const failed = report.failed || 0;
      const duplicates = report.duplicates || 0;
      toast.success("Import completed");
      setBanner({ type: "success", title: "Import completed", message: `Created: ${created} • Failed: ${failed} • Duplicates: ${duplicates}` });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Import queue failed", message: error?.message || "Unable to queue import job." });
      toast.error(error?.message || "Failed to queue import.");
    },
  });

  const createStudentMutation = useMutation({
    mutationFn: (payload) => adminApi.createStudent(payload),
    onSuccess: (payload) => {
      toast.success("Student account created");
      setCreatedCredentials(payload.credentials || null);
      setStudentForm({ fullName: "", email: "", department: "", enrollNumber: "", batch: "" });
      setBanner({ type: "success", title: "Student created", message: "Student can login directly using email and generated password." });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Create student failed", message: error?.message || "Unable to create student account." });
      toast.error(error?.message || "Unable to create student account");
    },
  });

  const importJobQuery = useQuery({
    queryKey: ["admin-student-import-job", activeImportJobId],
    queryFn: () => adminApi.getStudentImportJobStatus(activeImportJobId),
    enabled: Boolean(activeImportJobId),
    refetchInterval: (query) => {
      const status = query?.state?.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });

  const students = useMemo(() => studentsQuery.data?.data || [], [studentsQuery.data]);
  const studentPagination = studentsQuery.data?.pagination;
  const batches = useMemo(() => Array.isArray(batchesQuery.data) ? batchesQuery.data : batchesQuery.data?.data || [], [batchesQuery.data]);
  const departments = useMemo(() => Array.isArray(departmentsQuery.data) ? departmentsQuery.data : departmentsQuery.data?.data || [], [departmentsQuery.data]);

  // Auto-apply admin department filter and defaults
  const admin = useSelector((state) => state.adminAuth.admin);

  useEffect(() => {
    if (!admin) return;
    const adminDeptId = admin?.department?.id || admin?.departmentId || "";
    setDirectoryFilters((prev) => ({ ...prev, departmentId: prev.departmentId || adminDeptId }));
    // Default student create form department to admin's department name if available
    if (admin?.department?.name && !studentForm.department) {
      setStudentForm((prev) => ({ ...prev, department: admin.department.name }));
    }
  }, [admin]);
  const selectedStudent = studentProfileQuery.data;

  useEffect(() => {
    if (!selectedStudentId && students.length > 0) {
      setSelectedStudentId(students[0].id);
    }
  }, [selectedStudentId, students]);

  useEffect(() => {
    if (!importJobQuery.data) return;
    if (importJobQuery.data.status === "completed") {
      setBanner({ type: "success", title: "Import completed", message: "Refresh student list to review newly created accounts." });
      queryClient.invalidateQueries({ queryKey: ["admin-students"] });
      return;
    }
    if (importJobQuery.data.status === "failed") {
      setBanner({ type: "error", title: "Import failed", message: importJobQuery.data.error || "Import job failed during processing." });
      return;
    }
    if (importJobQuery.data.status === "queued" || importJobQuery.data.status === "processing") {
      setBanner({ type: "warning", title: "Import in progress", message: "Job is still running. Results will appear shortly." });
    }
  }, [importJobQuery.data, queryClient]);

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-warning/30 bg-warning/10 text-warning" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create Student Account</CardTitle>
          <CardDescription>No student registration is needed. Admin creates credentials directly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
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
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
                value={studentForm.department}
                onChange={(event) => setStudentForm((prev) => ({ ...prev, department: event.target.value }))}
                disabled={Boolean(admin)}
            >
                {!admin ? <option value="">Select department</option> : null}
                {admin && admin.department ? (
                  <option value={admin.department.name}>{admin.department.name}</option>
                ) : (
                  Array.isArray(departments) && departments.map((department) => (
                    <option key={department.id} value={department.name}>{department.name}</option>
                  ))
                )}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={studentForm.batch}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, batch: event.target.value }))}
            >
              <option value="">Select batch (optional)</option>
              {Array.isArray(batches)
                ? batches
                    .filter((batch) => !studentForm.department || String(batch.departmentId) === String(studentForm.department) || String(batch.department?.id) === String(studentForm.department))
                    .map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name}</option>
                    ))
                : null}
            </select>
            <Input
              placeholder="Enroll number"
              value={studentForm.enrollNumber}
              onChange={(event) => setStudentForm((prev) => ({ ...prev, enrollNumber: event.target.value }))}
            />
          </div>
          <p className="text-xs text-text-secondary">Student ID is auto-generated by the system. Password rule: First 3 letters of full name (first letter capitalized) + @ + last 3 digits of enroll number.</p>
          <Button
            onClick={() => createStudentMutation.mutate(studentForm)}
            disabled={
              createStudentMutation.isPending ||
              !studentForm.fullName.trim() ||
              !studentForm.email.trim() ||
              !studentForm.department.trim() ||
              !studentForm.enrollNumber.trim()
            }
          >
            {createStudentMutation.isPending ? "Creating..." : "Create Student"}
          </Button>
          {createdCredentials ? (
            <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
              <p className="font-semibold">Student credentials</p>
              <p>Email: {createdCredentials.identifier}</p>
              <p>Student ID: {createdCredentials.studentId}</p>
              <p>Password: {createdCredentials.password}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Bulk Import (Excel/CSV)</CardTitle>
          <CardDescription>Upload .xlsx/.xls/.csv file or paste CSV. Runs as async job and supports large imports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-background p-3 text-xs text-text-secondary">
            <p className="font-semibold text-text-secondary">Excel format (first row headers):</p>
            <p className="mt-1">fullName, email, enrollNumber, department, batch</p>
            <p className="mt-1">Optional: studentId (if omitted, system auto-generates it)</p>
            <p className="mt-1">Example: Alice Doe, alice@example.com, 20261001, Computer Science, CSE-2027-A</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="max-w-md" />
            {importFileName ? <p className="text-xs text-text-secondary">Loaded: {importFileName}</p> : null}
          </div>
          <Textarea rows={8} value={csvData} onChange={(event) => setCsvData(event.target.value)} />
          <div className="flex items-center gap-2">
            <Button onClick={() => importMutation.mutate({ csvData })} disabled={importMutation.isPending}>
              {importMutation.isPending ? "Queueing..." : "Start Import"}
            </Button>
            {activeImportJobId ? <p className="text-xs text-text-secondary">Job: {activeImportJobId}</p> : null}
          </div>

          {importJobQuery.data ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium text-text-primary">Status: {String(importJobQuery.data.status || "unknown").toUpperCase()}</p>
              {importJobQuery.data.result ? (
                <p className="mt-1 text-text-secondary">
                  Created: {importJobQuery.data.result.created || 0} • Failed: {importJobQuery.data.result.failed || 0} • Duplicates: {importJobQuery.data.result.duplicates || 0}
                </p>
              ) : null}
              {importJobQuery.data.error ? <p className="mt-1 text-danger">Error: {importJobQuery.data.error}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Student Directory</CardTitle>
          <CardDescription>Search/filter, inspect profile, reassign batch, and monitor bulk-import jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-2 md:grid-cols-4">
            <Input placeholder="Search by name/email" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={directoryFilters.departmentId}
              onChange={(event) => {
                setDirectoryFilters((prev) => ({ ...prev, departmentId: event.target.value }));
                setPage(1);
              }}
              disabled={Boolean(admin)}
            >
              {!admin ? <option value="">All departments</option> : null}
              {admin && admin.department ? (
                <option value={admin.department.id}>{admin.department.name}</option>
              ) : (
                Array.isArray(departments) && departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))
              )}
            </select>
            <select
              className="h-10 rounded-md border border-border px-3 text-sm"
              value={directoryFilters.batchId}
              onChange={(event) => {
                setDirectoryFilters((prev) => ({ ...prev, batchId: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">All batches</option>
              {Array.isArray(batches)
                ? batches
                    .filter((batch) => !directoryFilters.departmentId || String(batch.departmentId) === String(directoryFilters.departmentId))
                    .map((batch) => (
                      <option key={batch.id} value={batch.id}>{batch.name}</option>
                    ))
                : null}
            </select>
            <Button variant="outline" onClick={() => studentsQuery.refetch()}>Search</Button>
          </div>
          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2">
              {studentsQuery.isLoading ? (
                <div className="space-y-2">
                  <SkeletonBlock className="h-16" />
                  <SkeletonBlock className="h-16" />
                  <SkeletonBlock className="h-16" />
                </div>
              ) : null}
              {!studentsQuery.isLoading && students.length === 0 ? <p className="text-sm text-text-secondary">No students found for current filters.</p> : null}
              {Array.isArray(students) && students.map((student) => {
                const batchLabel = Array.isArray(student.batches) && student.batches.length > 0
                  ? student.batches.map((batch) => batch.name).join(", ")
                  : (student.batch?.name || "-");

                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => {
                      setSelectedStudentId(student.id);
                      setBatchIdInput("");
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${selectedStudentId === student.id ? "border-primary/40 bg-primary/10" : "border-border"}`}
                  >
                    <div>
                      <p className="font-medium text-text-primary">{student.fullName}</p>
                      <p className="text-xs text-text-secondary">{student.email} • {student.studentId}</p>
                    </div>
                    <div className="text-right text-xs text-text-secondary">
                      <p>{student.department?.name || "-"}</p>
                      <p className="max-w-[140px] truncate">{batchLabel}</p>
                    </div>
                  </button>
                );
              })}
              {(studentPagination?.totalPages || 1) > 1 ? (
                <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                  <p>Page {studentPagination?.page || page} of {studentPagination?.totalPages || 1}</p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={(studentPagination?.page || page) <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={(studentPagination?.page || 1) >= (studentPagination?.totalPages || 1)} onClick={() => setPage((prev) => prev + 1)}>Next</Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border border-border p-3">
              {studentProfileQuery.isLoading ? (
                <div className="space-y-2">
                  <SkeletonBlock className="h-6" />
                  <SkeletonBlock className="h-6" />
                  <SkeletonBlock className="h-10" />
                </div>
              ) : null}
              {!selectedStudent ? <p className="text-sm text-text-secondary">Select a student for profile details.</p> : null}
              {selectedStudent ? (
                <>
                  <p className="text-base font-semibold text-text-primary">{selectedStudent.fullName}</p>
                  <p className="text-xs text-text-secondary">{selectedStudent.email} • {selectedStudent.studentId}</p>
                  <p className="text-xs text-text-secondary">Department: {selectedStudent.department?.name || "-"}</p>
                  <p className="text-xs text-text-secondary">Total submissions: {selectedStudent._count?.submissions || 0}</p>
                  {Array.isArray(selectedStudent.batches) && selectedStudent.batches.length > 0 ? (
                    <div className="border-t border-border pt-2">
                      <p className="mb-2 text-xs font-medium text-text-primary">Assigned batches:</p>
                      <div className="space-y-1">
                        {selectedStudent.batches.map((batch) => (
                          <div key={batch.id} className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1 text-xs">
                            <span className="text-text-primary">{batch.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-text-secondary italic">No batches assigned yet</p>
                  )}

                  <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-3">
                    <select className="h-10 rounded-md border border-border px-3 text-sm sm:col-span-2" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                      <option value="">Select batch to add</option>
                      {Array.isArray(batches) && batches.map((batch) => (
                        <option key={batch.id} value={batch.id}>{batch.name} ({batch.department?.name || "-"})</option>
                      ))}
                    </select>
                    <Button
                      onClick={() => assignBatchMutation.mutate({ studentId: selectedStudent.id, batchId: batchIdInput })}
                      disabled={assignBatchMutation.isPending || !batchIdInput}
                    >
                      Add Batch
                    </Button>
                  </div>

                </>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      
    </div>
  );
}
