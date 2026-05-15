import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TypedConfirmDialog from "@/components/SuperAdmin/TypedConfirmDialog";
import SkeletonBlock from "@/components/common/SkeletonBlock";

export default function BatchesPage() {
  const [filters, setFilters] = useState({ search: "", collegeId: "" });
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ testId: "" });
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [assignBatchSearch, setAssignBatchSearch] = useState("");
  const [batchForm, setBatchForm] = useState({ name: "", year: new Date().getFullYear(), collegeId: "", departmentId: "" });
  const [editBatchId, setEditBatchId] = useState("");
  const [editCollegeId, setEditCollegeId] = useState("");
  const [editForm, setEditForm] = useState({ name: "", year: new Date().getFullYear(), departmentId: "" });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [batchIdInput, setBatchIdInput] = useState("");

  const collegesQuery = useQuery({
    queryKey: ["super-colleges-for-batches"],
    queryFn: () => superAdminApi.getColleges("?limit=100"),
  });

  const testsQuery = useQuery({
    queryKey: ["super-tests-for-batches", filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "100");
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getTests(`?${params.toString()}`);
    },
  });

  const createDepartmentsQuery = useQuery({
    queryKey: ["super-departments-for-create-batches", batchForm.collegeId],
    queryFn: () => superAdminApi.getDepartments(`?limit=100&collegeId=${encodeURIComponent(batchForm.collegeId)}`),
    enabled: Boolean(batchForm.collegeId),
  });

  const editDepartmentsQuery = useQuery({
    queryKey: ["super-departments-for-edit-batches", editCollegeId],
    queryFn: () => superAdminApi.getDepartments(`?limit=100&collegeId=${encodeURIComponent(editCollegeId)}`),
    enabled: Boolean(editCollegeId),
  });

  const batchesQuery = useQuery({
    queryKey: ["super-batches", page, filters.search, filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getBatches(`?${params.toString()}`);
    },
  });

  const assignBatchesQuery = useQuery({
    queryKey: ["super-batches-for-assignment", filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", "1");
      params.set("limit", "100");
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getBatches(`?${params.toString()}`);
    },
  });

  const studentsQuery = useQuery({
    queryKey: ["super-students-for-batches", studentPage, search, filters.collegeId],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(studentPage));
      params.set("limit", "20");
      if (search.trim()) params.set("search", search.trim());
      if (filters.collegeId) params.set("collegeId", filters.collegeId);
      return superAdminApi.getStudents(`?${params.toString()}`);
    },
  });

  const studentProfileQuery = useQuery({
    queryKey: ["super-student-profile", selectedStudentId],
    queryFn: () => superAdminApi.getStudents(`?studentId=${selectedStudentId}`),
    enabled: Boolean(selectedStudentId),
  });

  const createBatchMutation = useMutation({
    mutationFn: (payload) => superAdminApi.createBatch(payload),
    onSuccess: () => {
      toast.success("Batch created");
      setBatchForm({ name: "", year: new Date().getFullYear(), collegeId: "", departmentId: "" });
      setPage(1);
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to create batch.");
    },
  });

  const updateBatchMutation = useMutation({
    mutationFn: ({ batchId, payload }) => superAdminApi.updateBatch(batchId, payload),
    onSuccess: () => {
      toast.success("Batch updated");
      setEditBatchId("");
      setEditCollegeId("");
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to update batch.");
    },
  });

  const deleteBatchMutation = useMutation({
    mutationFn: ({ batchId, confirmationText }) => superAdminApi.deleteBatch(batchId, { confirmationText }),
    onSuccess: () => {
      toast.success("Batch deleted");
      setPendingDelete(null);
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to delete batch.");
    },
  });

  const assignBatchMutation = useMutation({
    mutationFn: ({ studentId, batchId }) => superAdminApi.updateStudent(studentId, { batchId }),
    onSuccess: () => {
      toast.success("Student batch updated successfully");
      setBatchIdInput("");
      studentsQuery.refetch();
      studentProfileQuery.refetch();
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to assign batch to student.");
    },
  });

  const assignMutation = useMutation({
    mutationFn: (payload) => superAdminApi.assignTestToBatches(payload),
    onSuccess: (payload) => {
      const assigned = Number(payload?.assigned || 0);
      const alreadyAssigned = Number(payload?.alreadyAssigned || 0);
      const invalidCount = Array.isArray(payload?.invalidBatchIds) ? payload.invalidBatchIds.length : 0;

      if (assigned > 0) {
        toast.success(`Assigned to ${assigned} batch${assigned === 1 ? "" : "es"}.`);
      }
      if (alreadyAssigned > 0) {
        toast.info(`${alreadyAssigned} batch${alreadyAssigned === 1 ? " was" : "es were"} already assigned.`);
      }
      if (invalidCount > 0) {
        toast.warning(`${invalidCount} invalid batch id${invalidCount === 1 ? "" : "s"} were ignored.`);
      }
      if (assigned === 0 && alreadyAssigned === 0 && invalidCount === 0) {
        toast.info("No assignments were made.");
      }

      setSelectedBatchIds([]);
      batchesQuery.refetch();
      assignBatchesQuery.refetch();
    },
    onError: (error) => {
      const invalidBatchIds = error?.details?.invalidBatchIds;
      if (Array.isArray(invalidBatchIds) && invalidBatchIds.length > 0) {
        toast.error(`No valid batches found. Invalid IDs: ${invalidBatchIds.join(", ")}`);
        return;
      }

      toast.error(error?.message || "Failed to assign test to batches.");
    },
  });

  const colleges = collegesQuery.data?.data || [];
  const tests = testsQuery.data?.data || [];
  const createDepartmentOptions = createDepartmentsQuery.data?.data || [];
  const editDepartmentOptions = editDepartmentsQuery.data?.data || [];
  const batches = batchesQuery.data?.data || [];
  const assignBatches = assignBatchesQuery.data?.data || [];
  const pagination = batchesQuery.data?.pagination;
  const students = studentsQuery.data?.data || [];
  const studentPagination = studentsQuery.data?.pagination;
  const selectedStudent = selectedStudentId ? students.find((s) => s.id === selectedStudentId) || studentProfileQuery.data : null;

  const finalBatchIds = useMemo(() => [...new Set(selectedBatchIds)], [selectedBatchIds]);

  const selectedBatchMap = useMemo(
    () => new Map(assignBatches.map((batch) => [String(batch.id), batch])),
    [assignBatches]
  );

  const selectedBatchDetails = useMemo(
    () => finalBatchIds.map((id) => selectedBatchMap.get(String(id))).filter(Boolean),
    [finalBatchIds, selectedBatchMap]
  );

  const filteredAssignBatches = useMemo(() => {
    const term = assignBatchSearch.trim().toLowerCase();
    if (!term) return assignBatches;

    return assignBatches.filter((batch) => {
      const text = `${batch.name || ""} ${batch.year || ""} ${batch.college?.name || ""} ${batch.department?.name || ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [assignBatches, assignBatchSearch]);

  useEffect(() => {
    setSelectedBatchIds([]);
    setAssignBatchSearch("");
  }, [filters.collegeId]);

  useEffect(() => {
    setSelectedStudentId("");
    setBatchIdInput("");
    setSearch("");
    setStudentPage(1);
  }, [filters.collegeId]);

  const toggleAssignBatchSelection = (batchId) => {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]
    );
  };

  const assign = async () => {
    if (!form.testId) {
      toast.error("Select a test before assignment.");
      return;
    }

    if (!finalBatchIds.length) {
      toast.error("Select at least one batch.");
      return;
    }

    assignMutation.mutate({ testId: form.testId, batchIds: finalBatchIds });
  };

  const createBatch = () => {
    if (!batchForm.name.trim() || !batchForm.collegeId || !batchForm.departmentId || !batchForm.year) {
      toast.error("Name, year, college, and department are required.");
      return;
    }

    createBatchMutation.mutate({
      name: batchForm.name.trim(),
      year: Number(batchForm.year),
      collegeId: batchForm.collegeId,
      departmentId: batchForm.departmentId,
    });
  };

  const openEdit = (batch) => {
    setEditBatchId(batch.id);
    setEditCollegeId(batch.collegeId || "");
    setEditForm({
      name: batch.name || "",
      year: Number(batch.year || new Date().getFullYear()),
      departmentId: batch.departmentId || "",
    });
  };

  const saveEdit = (batch) => {
    if (!editForm.name.trim() || !editForm.departmentId || !editForm.year) {
      toast.error("Name, year, and department are required.");
      return;
    }

    updateBatchMutation.mutate({
      batchId: batch.id,
      payload: {
        name: editForm.name.trim(),
        year: Number(editForm.year),
        departmentId: editForm.departmentId,
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Create Batch</CardTitle>
          <CardDescription>Super Admin can create and manage batches across colleges.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-5">
          <Input
            placeholder="Batch name"
            value={batchForm.name}
            onChange={(e) => setBatchForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Input
            type="number"
            min={2000}
            max={2100}
            placeholder="Year"
            value={batchForm.year}
            onChange={(e) => setBatchForm((prev) => ({ ...prev, year: Number(e.target.value) || "" }))}
          />
          <select
            className="h-10 rounded-lg border border-border px-2"
            value={batchForm.collegeId}
            onChange={(e) => setBatchForm((prev) => ({ ...prev, collegeId: e.target.value, departmentId: "" }))}
          >
            <option value="">Select college</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <select
            className="h-10 rounded-lg border border-border px-2"
            value={batchForm.departmentId}
            onChange={(e) => setBatchForm((prev) => ({ ...prev, departmentId: e.target.value }))}
          >
            <option value="">Select department</option>
            {createDepartmentOptions.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
          <Button className="bg-primary/100 hover:bg-primary" onClick={createBatch} disabled={createBatchMutation.isPending}>
            {createBatchMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </CardContent>
      </Card>
            <Card className="rounded-2xl border-border">
                    <CardHeader>
                      <CardTitle>Student Directory</CardTitle>
                      <CardDescription>Search/filter, inspect profile, reassign batch, and monitor bulk-import jobs.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 flex gap-2">
                        <Input placeholder="Search by name/email" value={search} onChange={(event) => { setSearch(event.target.value); setStudentPage(1); }} />
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
                          {students.map((student) => (
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
                                <p>{Array.isArray(student.batchIds) && student.batchIds.length > 0 ? `${student.batchIds.length} batch(es)` : "No batches"}</p>
                              </div>
                            </button>
                          ))}
                          {(studentPagination?.totalPages || 1) > 1 ? (
                            <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
                              <p>Page {studentPagination?.page || studentPage} of {studentPagination?.totalPages || 1}</p>
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" disabled={(studentPagination?.page || studentPage) <= 1} onClick={() => setStudentPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                                <Button variant="outline" size="sm" disabled={(studentPagination?.page || 1) >= (studentPagination?.totalPages || 1)} onClick={() => setStudentPage((prev) => prev + 1)}>Next</Button>
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
                              
                              {Array.isArray(selectedStudent.batchIds) && selectedStudent.batchIds.length > 0 ? (
                                <div className="border-t border-border pt-2">
                                  <p className="text-xs font-medium text-text-primary mb-2">Assigned Batches:</p>
                                  <div className="space-y-1">
                                    {selectedStudent.batchIds.map((batchId) => {
                                      const batch = batches.find(b => b.id === batchId);
                                      return batch ? (
                                        <div key={batchId} className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1 text-xs">
                                          <span className="text-text-primary">{batch.name}</span>
                                        </div>
                                      ) : null;
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-text-secondary italic">No batches assigned yet</p>
                              )}
            
                              <div className="grid gap-2 sm:grid-cols-3 border-t border-border pt-2">
                                <select className="h-10 rounded-md border border-border px-3 text-sm sm:col-span-2" value={batchIdInput} onChange={(event) => setBatchIdInput(event.target.value)}>
                                  <option value="">Select batch to add</option>
                                  {batches.map((batch) => (
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

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle>Assign Tests Globally</CardTitle>
          <CardDescription>Select a test from live database results and choose batches from live backend data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">

          <div className="grid gap-3 sm:grid-cols-2">
          <select className="h-10 rounded-lg border border-border px-2" value={form.testId} onChange={(e) => setForm({ ...form, testId: e.target.value })}>
            <option value="">Select test</option>
            {tests.map((test) => (
              <option key={test.id} value={test.id}>{test.title} ({test.status || "-"}) • {test.college?.name || "-"} • #{String(test.id).slice(0, 8)}</option>
            ))}
          </select>
          <Input
            placeholder="Search batches to assign"
            value={assignBatchSearch}
            onChange={(e) => setAssignBatchSearch(e.target.value)}
          />
          </div>

          <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedBatchIds((prev) => [...new Set([...prev, ...filteredAssignBatches.map((batch) => batch.id)])])}
              >
                Select Visible
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelectedBatchIds((prev) => prev.filter((id) => !filteredAssignBatches.some((batch) => batch.id === id)))}
              >
                Clear Visible
              </Button>
            </div>
            {filteredAssignBatches.length === 0 ? <p className="text-xs text-text-secondary">No batches found for assignment.</p> : null}
            {filteredAssignBatches.map((batch) => (
              <label key={batch.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-text-primary">{batch.name} ({batch.year})</p>
                  <p className="text-xs text-text-secondary">{batch.college?.name || "-"} • {batch.department?.name || "-"} • Students: {batch._count?.students || 0}</p>
                </div>
                <input
                  type="checkbox"
                  className="size-4"
                  checked={finalBatchIds.includes(batch.id)}
                  onChange={() => toggleAssignBatchSelection(batch.id)}
                />
              </label>
            ))}
          </div>

          <div className="flex items-center justify-end">
          <Button className="bg-primary/100 hover:bg-primary" onClick={assign} disabled={assignMutation.isPending || testsQuery.isLoading}>
            {assignMutation.isPending ? "Assigning..." : "Assign"}
          </Button>
          </div>

          <p className="text-xs text-text-secondary sm:col-span-2">
            Selected batch IDs: {finalBatchIds.length}
          </p>
          {selectedBatchDetails.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {selectedBatchDetails.map((batch) => (
                <div key={batch.id} className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary">
                  <p className="font-medium text-text-primary">{batch.name} ({batch.year})</p>
                  <p>{batch.college?.name || "-"} • {batch.department?.name || "-"}</p>
                  <p>Students: {batch._count?.students || 0} • Tests: {batch._count?.tests || 0}</p>
                </div>
              ))}
            </div>
          ) : null}
          {testsQuery.isLoading ? <p className="text-xs text-text-secondary sm:col-span-2">Loading tests from database...</p> : null}
          {testsQuery.isError ? <p className="text-xs text-danger sm:col-span-2">{testsQuery.error?.message || "Failed to load tests from backend."}</p> : null}
          {!testsQuery.isLoading && !testsQuery.isError && tests.length === 0 ? <p className="text-xs text-text-secondary sm:col-span-2">No tests found in database for the selected filters.</p> : null}
          {assignBatchesQuery.isLoading ? <p className="text-xs text-text-secondary sm:col-span-2">Loading batches for dropdown...</p> : null}
          {assignBatchesQuery.isError ? <p className="text-xs text-danger sm:col-span-2">{assignBatchesQuery.error?.message || "Failed to load batch dropdown options."}</p> : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>Filter Batches</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Search by batch/department/college"
            value={filters.search}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, search: e.target.value }));
              setPage(1);
            }}
          />
          <select
            className="h-10 rounded-lg border border-border px-2"
            value={filters.collegeId}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, collegeId: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All colleges</option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>{college.name}</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => { setPage(1); batchesQuery.refetch(); }}>Apply Filter</Button>
          <Button variant="outline" onClick={() => { setFilters({ search: "", collegeId: "" }); setPage(1); }}>
            Reset
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardHeader><CardTitle>All Batches</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {batchesQuery.isLoading ? <p className="text-sm text-text-secondary">Loading batches from backend...</p> : null}
          {batchesQuery.isError ? <p className="text-sm text-danger">{batchesQuery.error?.message || "Failed to load batches."}</p> : null}
          {!batchesQuery.isLoading && !batchesQuery.isError && batches.length === 0 ? (
            <p className="text-sm text-text-secondary">No batches found for selected filters.</p>
          ) : null}

          {batches.map((batch) => {
            const isEditing = editBatchId === batch.id;

            return (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
                <div className="min-w-70 flex-1">
                  {isEditing ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="Batch name"
                      />
                      <Input
                        type="number"
                        min={2000}
                        max={2100}
                        value={editForm.year}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, year: Number(e.target.value) || "" }))}
                        placeholder="Year"
                      />
                      <select
                        className="h-10 rounded-lg border border-border px-2"
                        value={editForm.departmentId}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, departmentId: e.target.value }))}
                      >
                        <option value="">Select department</option>
                        {editDepartmentOptions.map((department) => (
                          <option key={department.id} value={department.id}>{department.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-text-primary">{batch.name} ({batch.year})</p>
                      <p className="text-xs text-text-secondary">
                        {batch.college?.name || "-"} • {batch.department?.name || "-"} • Students: {batch._count?.students || 0} • Tests: {batch._count?.tests || 0}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <Button size="sm" onClick={() => saveEdit(batch)} disabled={updateBatchMutation.isPending}>Save</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditBatchId("")}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openEdit(batch)}>Edit</Button>
                      <Button size="sm" variant="destructive" onClick={() => setPendingDelete(batch)} disabled={deleteBatchMutation.isPending}>Delete</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {(pagination?.pages || 1) > 1 ? (
            <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-secondary">
              <p>Page {pagination?.page || page} of {pagination?.pages || 1}</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(pagination?.page || page) <= 1 || batchesQuery.isFetching}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(pagination?.page || page) >= (pagination?.pages || 1) || batchesQuery.isFetching}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TypedConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Typed Confirmation Required"
        description={`Delete ${pendingDelete?.name || "this batch"}? This will detach linked students and tests.`}
        expectedText={`DELETE ${pendingDelete?.name || ""}`}
        inputLabel="Type the exact phrase"
        confirmLabel="Delete Batch"
        confirmVariant="destructive"
        onConfirm={async (typedText) => {
          if (pendingDelete?.id) {
            deleteBatchMutation.mutate({ batchId: pendingDelete.id, confirmationText: typedText });
          }
        }}
      />
    </div>
  );
}
