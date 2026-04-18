import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { adminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import SkeletonBlock from "@/components/common/SkeletonBlock";

const PAGE_SIZE = 8;

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", year: new Date().getFullYear(), departmentId: "" });
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [bulkCsv, setBulkCsv] = useState("email,studentId\n");
  const [assignTest, setAssignTest] = useState({ testId: "", batchId: "" });
  const [batchPage, setBatchPage] = useState(1);
  const [banner, setBanner] = useState({ type: "", title: "", message: "" });

  const batchesQuery = useQuery({
    queryKey: ["admin-batches"],
    queryFn: adminApi.getBatches,
  });

  const testsQuery = useQuery({
    queryKey: ["admin-tests-for-batch"],
    queryFn: () => adminApi.getTests("?page=1&limit=100"),
  });

  const departmentsQuery = useQuery({
    queryKey: ["admin-departments-for-batches"],
    queryFn: adminApi.getDepartments,
  });

  const selectedBatchQuery = useQuery({
    queryKey: ["admin-batch-detail", selectedBatchId],
    queryFn: () => adminApi.getBatchDetail(selectedBatchId),
    enabled: Boolean(selectedBatchId),
  });

  const createBatchMutation = useMutation({
    mutationFn: adminApi.createBatch,
    onSuccess: () => {
      toast.success("Batch created successfully.");
      setBanner({ type: "success", title: "Batch created", message: "The new batch is now available in the list." });
      setForm({ name: "", year: new Date().getFullYear(), departmentId: "" });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      if (error?.code === "BATCH_DUPLICATE_NAME") {
        toast.error("Duplicate batch name for this year/department.");
        setBanner({ type: "error", title: "Duplicate batch name", message: "Use a unique name for this year and department." });
        return;
      }
      setBanner({ type: "error", title: "Batch creation failed", message: error?.message || "Please review input fields and retry." });
      toast.error(error?.message || "Failed to create batch.");
    },
  });

  const bulkStudentsMutation = useMutation({
    mutationFn: ({ batchId, payload }) => adminApi.bulkBatchStudents(batchId, payload),
    onSuccess: () => {
      toast.success("Students added to batch.");
      setBanner({ type: "success", title: "Students imported", message: "Batch roster has been refreshed." });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Import failed", message: error?.message || "CSV data is invalid or incomplete." });
      toast.error(error?.message || "Failed to import students.");
    },
  });

  const removeStudentMutation = useMutation({
    mutationFn: ({ batchId, studentId }) => adminApi.removeBatchStudent(batchId, studentId),
    onSuccess: () => {
      toast.success("Student removed from batch.");
      setBanner({ type: "success", title: "Student removed", message: "Batch membership has been updated." });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
    },
    onError: (error) => {
      const warn = error?.details?.warning;
      if (warn?.type === "ACTIVE_TEST_PRESENT") {
        setBanner({ type: "warning", title: "Removal blocked", message: `Student has an active test: ${warn.testTitle || "in progress"}.` });
        toast.warning(`Cannot remove: active test ${warn.testTitle || "present"}.`);
        return;
      }
      setBanner({ type: "error", title: "Removal failed", message: error?.message || "Could not remove student from batch." });
      toast.error(error?.message || "Failed to remove student.");
    },
  });

  const assignTestMutation = useMutation({
    mutationFn: ({ testId, batchId }) => adminApi.assignTestToBatch(testId, { batchId }),
    onSuccess: () => {
      toast.success("Test assigned to batch.");
      setBanner({ type: "success", title: "Test assigned", message: "The selected test is now linked to this batch." });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail", selectedBatchId] });
      setAssignTest({ testId: "", batchId: "" });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Assignment failed", message: error?.message || "Unable to assign test to batch." });
      toast.error(error?.message || "Failed to assign test.");
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: (batchId) => adminApi.deleteBatch(batchId),
    onSuccess: () => {
      toast.success("Batch deleted successfully.");
      setBanner({ type: "success", title: "Batch deleted", message: "The batch has been removed." });
      setSelectedBatchId("");
      queryClient.invalidateQueries({ queryKey: ["admin-batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin-batch-detail"] });
    },
    onError: (error) => {
      setBanner({ type: "error", title: "Delete failed", message: error?.message || "Batch could not be deleted." });
      toast.error(error?.message || "Failed to delete batch.");
    },
  });

  const batches = useMemo(() => batchesQuery.data || [], [batchesQuery.data]);
  const departments = useMemo(() => departmentsQuery.data || [], [departmentsQuery.data]);
  const pagedBatches = useMemo(() => {
    const start = (batchPage - 1) * PAGE_SIZE;
    return batches.slice(start, start + PAGE_SIZE);
  }, [batchPage, batches]);
  const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const selectedBatch = selectedBatchQuery.data;

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
          <CardTitle>Create Batch</CardTitle>
          <CardDescription>Name + department + academic year with duplicate-name safeguards.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Input placeholder="Batch name (CSE-2027-A)" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
          <Input type="number" value={form.year} onChange={(event) => setForm((prev) => ({ ...prev, year: Number(event.target.value) }))} />
          <select
            className="h-10 rounded-md border border-slate-200 px-3 text-sm"
            value={form.departmentId}
            onChange={(event) => setForm((prev) => ({ ...prev, departmentId: event.target.value }))}
            disabled={departmentsQuery.isLoading}
          >
            <option value="">{departmentsQuery.isLoading ? "Loading departments..." : "Select department"}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <Button
            onClick={() => createBatchMutation.mutate(form)}
            disabled={createBatchMutation.isPending || !form.name || !form.departmentId}
          >
            {createBatchMutation.isPending ? "Creating..." : "Create Batch"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card className="rounded-2xl border-slate-200">
          <CardHeader><CardTitle>Batch List</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {batchesQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
                <SkeletonBlock className="h-18" />
              </div>
            ) : null}
            {!batchesQuery.isLoading && pagedBatches.length === 0 ? <p className="text-sm text-slate-500">No batches found. Create your first batch above.</p> : null}
            {pagedBatches.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => setSelectedBatchId(batch.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left ${selectedBatchId === batch.id ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}
              >
                <p className="font-medium text-slate-800">{batch.name}</p>
                <p className="text-xs text-slate-500">Year: {batch.year} • {batch.department?.name || "-"} • Students: {batch._count?.students || 0}</p>
                {batch.isArchived ? <p className="mt-1 text-xs font-semibold text-amber-700">Archived</p> : null}
              </button>
            ))}
            {batches.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                <p>Page {batchPage} of {totalPages}</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={batchPage <= 1} onClick={() => setBatchPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={batchPage >= totalPages} onClick={() => setBatchPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Batch Detail</CardTitle>
            {selectedBatch ? (
              <Button
                variant="outline"
                onClick={() => {
                  const shouldDelete = window.confirm("Delete this batch permanently?");
                  if (shouldDelete) {
                    deleteBatchMutation.mutate(selectedBatch.id);
                  }
                }}
                disabled={deleteBatchMutation.isPending}
              >
                {deleteBatchMutation.isPending ? "Deleting..." : "Delete Batch"}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedBatchQuery.isLoading ? (
              <div className="space-y-2">
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-40" />
                <SkeletonBlock className="h-24" />
              </div>
            ) : null}
            {!selectedBatch ? <p className="text-sm text-slate-500">Select a batch to view detail.</p> : null}
            {selectedBatch ? (
              <>
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-slate-800">{selectedBatch.name}</p>
                  <p className="text-xs text-slate-500">{selectedBatch.department?.name} • Academic year {selectedBatch.year}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Add Students (CSV)</p>
                  <Textarea rows={5} value={bulkCsv} onChange={(event) => setBulkCsv(event.target.value)} />
                  <Button
                    onClick={() => bulkStudentsMutation.mutate({ batchId: selectedBatch.id, payload: { csvData: bulkCsv } })}
                    disabled={bulkStudentsMutation.isPending}
                  >
                    {bulkStudentsMutation.isPending ? "Importing..." : "Import Students"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Assign Test to Batch</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={assignTest.testId} onChange={(event) => setAssignTest((prev) => ({ ...prev, testId: event.target.value }))}>
                      <option value="">Select test</option>
                      {(testsQuery.data?.data || []).map((test) => <option key={test.id} value={test.id}>{test.title}</option>)}
                    </select>
                    <Button
                      onClick={() => assignTestMutation.mutate({ testId: assignTest.testId, batchId: assignTest.batchId || selectedBatch.id })}
                      disabled={assignTestMutation.isPending || !assignTest.testId}
                    >Assign</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Students</p>
                  {(selectedBatch.students || []).map((student) => (
                    <div key={student.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{student.fullName}</p>
                        <p className="text-xs text-slate-500">{student.email} • Attempts: {student._count?.submissions || 0}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => removeStudentMutation.mutate({ batchId: selectedBatch.id, studentId: student.id })}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
