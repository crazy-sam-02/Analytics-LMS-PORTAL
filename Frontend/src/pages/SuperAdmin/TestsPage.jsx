import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SkeletonBlock from "@/components/common/SkeletonBlock";
import ConfirmActionDialog from "@/components/Admin/ConfirmActionDialog";
import TestCreationDialog from "@/components/Admin/TestCreationDialog";

const PAGE_SIZE = 10;
const STATUS_OPTIONS = ["ALL", "DRAFT", "UPCOMING", "LIVE", "COMPLETED", "ARCHIVED"];

export default function TestsPage() {
  const dispatch = useDispatch();
  const colleges = useSelector((state) => state.superAdminPanel.colleges);

  const [banner, setBanner] = useState({ type: "", title: "", message: "" });
  const [cloneTarget, setCloneTarget] = useState({
    testId: "",
    destinationCollegeId: "",
    assignmentMethod: "batch_wise",
    departmentIds: [],
    batchIds: [],
  });
  const [scopeOptions, setScopeOptions] = useState([]);
  const [loadingScopeOptions, setLoadingScopeOptions] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");
  const [pendingDeactivate, setPendingDeactivate] = useState(null);

  const [tests, setTests] = useState([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const loadTests = async () => {
    setLoadingTests(true);
    try {
      const response = await superAdminApi.getTests("?page=1&limit=100");
      setTests(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      setBanner({ type: "error", title: "Failed to load tests", message: error?.message || "Unable to fetch global tests." });
    } finally {
      setLoadingTests(false);
    }
  };

  useEffect(() => {
    dispatch(fetchSuperColleges());
    loadTests();
  }, [dispatch]);

  const filteredTests = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tests.filter((item) => {
      const statusOk = statusFilter === "ALL" || String(item.status || "").toUpperCase() === statusFilter;
      if (!statusOk) return false;
      if (!term) return true;
      const haystack = `${item.title || ""} ${item.subject || ""} ${item.college?.name || ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, statusFilter, tests]);

  const totalPages = Math.max(1, Math.ceil(filteredTests.length / PAGE_SIZE));
  const pagedTests = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredTests.slice(start, start + PAGE_SIZE);
  }, [filteredTests, page]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    const loadScopeOptions = async () => {
      if (!cloneTarget.destinationCollegeId) {
        setScopeOptions([]);
        return;
      }

      setLoadingScopeOptions(true);
      try {
        if (cloneTarget.assignmentMethod === "department_wise") {
          const response = await superAdminApi.getDepartments(
            `?page=1&limit=100&collegeId=${encodeURIComponent(cloneTarget.destinationCollegeId)}`
          );
          setScopeOptions(Array.isArray(response?.data) ? response.data : []);
        } else {
          const response = await superAdminApi.getBatches(
            `?page=1&limit=100&collegeId=${encodeURIComponent(cloneTarget.destinationCollegeId)}`
          );
          setScopeOptions(Array.isArray(response?.data) ? response.data : []);
        }
      } catch {
        setScopeOptions([]);
      } finally {
        setLoadingScopeOptions(false);
      }
    };

    loadScopeOptions();
  }, [cloneTarget.destinationCollegeId, cloneTarget.assignmentMethod]);

  const filteredScopeOptions = useMemo(() => {
    const term = scopeSearch.trim().toLowerCase();
    if (!term) return scopeOptions;

    return scopeOptions.filter((item) => {
      const text = `${item.name || ""} ${item.year || ""} ${item.college?.name || ""} ${item.department?.name || ""}`.toLowerCase();
      return text.includes(term);
    });
  }, [scopeOptions, scopeSearch]);

  const selectedScopeIds =
    cloneTarget.assignmentMethod === "department_wise" ? cloneTarget.departmentIds : cloneTarget.batchIds;

  const clone = async () => {
    if (!cloneTarget.testId || !cloneTarget.destinationCollegeId) {
      setBanner({ type: "warning", title: "Clone details required", message: "Provide source test and destination college." });
      return;
    }

    if (!selectedScopeIds.length) {
      setBanner({
        type: "warning",
        title: "Assignment scope required",
        message: cloneTarget.assignmentMethod === "department_wise"
          ? "Select at least one department for assignment."
          : "Select at least one batch for assignment.",
      });
      return;
    }

    setSubmitting(true);
    try {
      await superAdminApi.cloneTest(cloneTarget.testId, {
        destinationCollegeId: cloneTarget.destinationCollegeId,
        assignmentMethod: cloneTarget.assignmentMethod,
        departmentIds: cloneTarget.assignmentMethod === "department_wise" ? cloneTarget.departmentIds : [],
        batchIds: cloneTarget.assignmentMethod === "batch_wise" ? cloneTarget.batchIds : [],
      });
      toast.success("Test cloned.");
      setBanner({ type: "success", title: "Clone complete", message: "Test cloned to destination college as a draft with selected assignment scope." });
      setCloneTarget({
        testId: "",
        destinationCollegeId: "",
        assignmentMethod: "batch_wise",
        departmentIds: [],
        batchIds: [],
      });
      setScopeOptions([]);
      setScopeSearch("");
      await loadTests();
    } catch (error) {
      setBanner({ type: "error", title: "Clone failed", message: error?.message || "Unable to clone test." });
      toast.error(error?.message || "Failed to clone test.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!pendingDeactivate?.id) {
      setPendingDeactivate(null);
      return;
    }

    setSubmitting(true);
    try {
      await superAdminApi.deactivateTest(pendingDeactivate.id);
      toast.success("Test deactivated.");
      setBanner({ type: "success", title: "Test deactivated", message: "The test has been archived successfully." });
      setPendingDeactivate(null);
      await loadTests();
    } catch (error) {
      setBanner({ type: "error", title: "Deactivate failed", message: error?.message || "Unable to deactivate test." });
      toast.error(error?.message || "Failed to deactivate test.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {banner.type ? (
        <Alert variant={banner.type === "error" ? "destructive" : "default"} className={banner.type === "warning" ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Create Global Test</CardTitle>
            <CardDescription>Uses the exact same multi-step workflow and system design as Admin test creation.</CardDescription>
          </div>
          <TestCreationDialog context="super_admin" onCreated={loadTests} />
        </CardHeader>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Clone Test Across Colleges</CardTitle>
          <CardDescription>Super admin can clone and assign the test by department or batch inside the selected destination college.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="clone-test-id" className="text-sm font-medium text-slate-700">Source test</label>
            <select
              id="clone-test-id"
              className="h-10 w-full rounded-lg border border-slate-200 px-2"
              value={cloneTarget.testId}
              onChange={(e) => setCloneTarget((p) => ({ ...p, testId: e.target.value }))}
            >
              <option value="">Select test</option>
              {tests.map((test) => (
                <option key={test.id} value={test.id}>
                  {test.title} ({test.subject || "-"}) • {test.college?.name || "-"}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="clone-destination-college" className="text-sm font-medium text-slate-700">Destination college</label>
            <select id="clone-destination-college" className="h-10 w-full rounded-lg border border-slate-200 px-2" value={cloneTarget.destinationCollegeId} onChange={(e) => setCloneTarget((p) => ({ ...p, destinationCollegeId: e.target.value }))}>
              <option value="">Destination college</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>{college.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="clone-assignment-method" className="text-sm font-medium text-slate-700">Assignment mode</label>
            <select
              id="clone-assignment-method"
              className="h-10 w-full rounded-lg border border-slate-200 px-2"
              value={cloneTarget.assignmentMethod}
              onChange={(e) => {
                const method = e.target.value;
                setCloneTarget((p) => ({
                  ...p,
                  assignmentMethod: method,
                  departmentIds: [],
                  batchIds: [],
                }));
                setScopeSearch("");
              }}
            >
              <option value="batch_wise">Batch wise</option>
              <option value="department_wise">Department wise</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button className="w-full bg-blue-500 hover:bg-blue-600" onClick={clone} disabled={submitting || !cloneTarget.testId || !cloneTarget.destinationCollegeId || !selectedScopeIds.length}>Clone Test</Button>
          </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700">
                {cloneTarget.assignmentMethod === "department_wise" ? "Select Departments" : "Select Batches"}
              </p>
              <Input
                placeholder={cloneTarget.assignmentMethod === "department_wise" ? "Search departments" : "Search batches"}
                value={scopeSearch}
                onChange={(e) => setScopeSearch(e.target.value)}
                className="max-w-64"
              />
            </div>

            <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {loadingScopeOptions ? <p className="text-xs text-slate-500">Loading options...</p> : null}
              {!loadingScopeOptions && !cloneTarget.destinationCollegeId ? <p className="text-xs text-slate-500">Choose destination college to load options.</p> : null}
              {!loadingScopeOptions && cloneTarget.destinationCollegeId && filteredScopeOptions.length === 0 ? <p className="text-xs text-slate-500">No matching options found.</p> : null}

              {filteredScopeOptions.map((item) => {
                const isChecked = selectedScopeIds.includes(item.id);
                return (
                  <label key={item.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{item.name}</p>
                      {cloneTarget.assignmentMethod === "batch_wise" ? (
                        <p className="text-xs text-slate-500">{item.year || "-"} • {item.department?.name || "-"}</p>
                      ) : (
                        <p className="text-xs text-slate-500">{item.college?.name || "-"}</p>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={isChecked}
                      onChange={() => {
                        setCloneTarget((prev) => {
                          if (prev.assignmentMethod === "department_wise") {
                            const next = isChecked
                              ? prev.departmentIds.filter((id) => id !== item.id)
                              : [...prev.departmentIds, item.id];
                            return { ...prev, departmentIds: next };
                          }

                          const next = isChecked
                            ? prev.batchIds.filter((id) => id !== item.id)
                            : [...prev.batchIds, item.id];
                          return { ...prev, batchIds: next };
                        });
                      }}
                    />
                  </label>
                );
              })}
            </div>

            <p className="text-xs text-slate-500">
              Selected: {selectedScopeIds.length}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>All Global Tests</CardTitle>
          <CardDescription>Admin-like searchable test inventory with lifecycle visibility and archive actions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="test-search" className="text-sm font-medium text-slate-700">Search</label>
              <Input id="test-search" placeholder="Search by title, subject, or college" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="test-status-filter" className="text-sm font-medium text-slate-700">Status</label>
              <select id="test-status-filter" className="h-10 w-full rounded-lg border border-slate-200 px-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          {loadingTests ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
              <SkeletonBlock className="h-16" />
            </div>
          ) : null}

          {!loadingTests && pagedTests.length === 0 ? <p className="text-sm text-slate-500">No tests found for selected filters.</p> : null}

          {!loadingTests ? (
            <div className="space-y-2">
              {pagedTests.map((test) => (
                <div key={test.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <div>
                    <p className="font-medium text-slate-800">{test.title}</p>
                    <p className="text-xs text-slate-500">{test.subject} | {test.status} | {test.college?.name || "-"}</p>
                    <p className="text-xs text-slate-500">Questions: {test?._count?.questions || 0} | Attempts: {test?._count?.submissions || 0}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setPendingDeactivate(test)} disabled={submitting || String(test.status || "").toUpperCase() === "ARCHIVED"}>
                    {String(test.status || "").toUpperCase() === "ARCHIVED" ? "Archived" : "Deactivate"}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {filteredTests.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
              <p>Page {page} of {totalPages}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}>Next</Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={Boolean(pendingDeactivate)}
        onOpenChange={(open) => !open && setPendingDeactivate(null)}
        title="Deactivate Test"
        description={`Deactivate "${pendingDeactivate?.title || "this test"}"? It will no longer be active for colleges.`}
        confirmLabel="Deactivate"
        confirmVariant="destructive"
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
