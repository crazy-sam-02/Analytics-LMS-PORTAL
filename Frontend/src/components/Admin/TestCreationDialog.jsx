import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import {
  addQuestionsFromBank,
  addQuestionRow,
  clearTestCreationErrors,
  goToNextCreationStep,
  goToPreviousCreationStep,
  hydrateTestCreationDraft,
  increaseQuestionRenderLimit,
  openTestCreationDialog,
  removeQuestionRow,
  replaceQuestionsFromBulk,
  setDialogOpenState,
  setQuestionInputMode,
  setTestCreationErrors,
  setTestCreationStep,
  submitTestCreation,
  toggleBatchId,
  setTestCreationContext,
  updateQuestionRow,
  updateRestrictionsField,
  updateTestCreationField,
  validateCurrentStep,
} from "@/features/Admin/testCreationSlice";
import { fetchAdminTests, fetchBatches, fetchDepartments, fetchStudents } from "@/features/Admin/adminPanelSlice";
import { fetchSuperColleges } from "@/features/SuperAdmin/superAdminPanelSlice";
import { superAdminApi } from "@/services/api";
import {
  fetchQuestionBankQuestions,
  fetchQuestionSubjects,
  setQuestionBankFilters,
  toggleQuestionBankSelected,
} from "@/features/Admin/questionBankSlice";

// Custom UI Components (Replacing Shadcn)
import { Button } from "@/components/ui/button"; 
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X, FileText, Clock, Users, HelpCircle, ShieldCheck, Send, AlertTriangle, Eye, Rocket } from "lucide-react";

const ADMIN_DRAFT_KEY = "admin-test-creation-draft";
const SUPER_ADMIN_DRAFT_KEY = "super-admin-test-creation-draft";
const SUBJECT_OPTIONS = ["Data Structures", "Algorithms", "DBMS", "Operating Systems", "Computer Networks", "Aptitude"];
const EVALUATION_RULE_OPTIONS = [
  { value: "BEST_ATTEMPT", label: "Best Attempt" },
  { value: "LAST_ATTEMPT", label: "Last Attempt" },
];
const PUBLISH_STATE_OPTIONS = [
  { value: "DRAFT", label: "Save as Draft" },
  { value: "UPCOMING", label: "Schedule as Upcoming" },
  { value: "PUBLISH_NOW", label: "Publish Immediately" },
];
const QUESTION_TYPE_OPTIONS = [
  { value: "mcq", label: "MCQ" },
  { value: "true_false", label: "True / False" },
  { value: "fill_blank", label: "Fill in the Blank" },
  { value: "paragraph", label: "Paragraph" },
];
const DIFFICULTY_OPTIONS = ["EASY", "MEDIUM", "HARD"];
const ADMIN_STUDENTS_PAGE_LIMIT = 100;

const PROCTORING_PRESETS = {
  STRICT_EXAM: {
    fullscreenRequired: true,
    tabSwitch: "monitored",
    copyPaste: "monitored",
    windowBlur: true,
    screenshotDetection: true,
    rightClickDisabled: true,
    devtoolsDetection: true,
    violationThreshold: 2,
  },
  STANDARD_TEST: {
    fullscreenRequired: true,
    tabSwitch: "monitored",
    copyPaste: "allowed",
    windowBlur: true,
    screenshotDetection: false,
    rightClickDisabled: true,
    devtoolsDetection: true,
    violationThreshold: 4,
  },
  OPEN_ASSIGNMENT: {
    fullscreenRequired: false,
    tabSwitch: "allowed",
    copyPaste: "allowed",
    windowBlur: false,
    screenshotDetection: false,
    rightClickDisabled: false,
    devtoolsDetection: false,
    violationThreshold: 8,
  },
};
export default function TestCreationDialog({ context = "admin", onCreated }) {
  const dispatch = useDispatch();
  const testCreation = useSelector((state) => state.testCreation);
  const departments = useSelector((state) => state.adminPanel.departments.data);
  const batches = useSelector((state) => state.adminPanel.batches.data);
  const students = useSelector((state) => state.adminPanel.students.data);
  const colleges = useSelector((state) => state.superAdminPanel.colleges);
  const qb = useSelector((state) => state.questionBank);
  const { form, open, step, stepTitles, errors, isSubmitting, questionRenderLimit } = testCreation;
  const isSuperAdminContext = context === "super_admin";
  const draftKey = isSuperAdminContext ? SUPER_ADMIN_DRAFT_KEY : ADMIN_DRAFT_KEY;
  const [bulkJson, setBulkJson] = useState("");
  const [quickEditIndex, setQuickEditIndex] = useState(null);
  const [publishDialog, setPublishDialog] = useState({ open: false, publishState: "PUBLISH_NOW" });
  const [isConfirmPublishing, setIsConfirmPublishing] = useState(false);
  const [externalDraftWarning, setExternalDraftWarning] = useState(false);
  const [qbPage, setQbPage] = useState(1);
  const [superDepartments, setSuperDepartments] = useState([]);
  const [superBatches, setSuperBatches] = useState([]);

  const resetBodyInteractionLock = () => {
    document.body.style.pointerEvents = "";
  };

  // Persistence and Fetching
  useEffect(() => {
    dispatch(setTestCreationContext(context));
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      try { dispatch(hydrateTestCreationDraft(JSON.parse(raw))); } catch { localStorage.removeItem(draftKey); }
    }
  }, [context, dispatch, draftKey]);

  useEffect(() => { localStorage.setItem(draftKey, JSON.stringify(form)); }, [draftKey, form]);

  useEffect(() => {
    if (open) {
      if (isSuperAdminContext) {
        dispatch(fetchSuperColleges());
      } else {
        dispatch(fetchDepartments());
        dispatch(fetchBatches());
        dispatch(fetchStudents(`?page=1&limit=${ADMIN_STUDENTS_PAGE_LIMIT}`));
        dispatch(fetchQuestionSubjects());
      }
      document.body.style.overflow = "hidden"; // Prevent background scroll
    } else {
      document.body.style.overflow = "unset";
    }
  }, [dispatch, isSuperAdminContext, open]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "unset";
      resetBodyInteractionLock();
    };
  }, []);

  useEffect(() => {
    if (!isSuperAdminContext || !open) {
      return;
    }

    let cancelled = false;

    const loadSuperDepartments = async () => {
      try {
        const firstPage = await superAdminApi.getDepartments("?page=1&limit=100");
        const firstItems = Array.isArray(firstPage?.data) ? firstPage.data : [];
        const totalPages = Number(firstPage?.pagination?.pages || 1);

        if (totalPages <= 1) {
          if (!cancelled) {
            setSuperDepartments(firstItems);
          }
          return;
        }

        const pageRequests = [];
        for (let page = 2; page <= totalPages; page += 1) {
          pageRequests.push(superAdminApi.getDepartments(`?page=${page}&limit=100`));
        }

        const restPages = await Promise.all(pageRequests);
        const merged = [
          ...firstItems,
          ...restPages.flatMap((result) => (Array.isArray(result?.data) ? result.data : [])),
        ];
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        if (!cancelled) {
          setSuperDepartments(deduped);
        }
      } catch {
        if (!cancelled) {
          setSuperDepartments([]);
        }
      }
    };

    loadSuperDepartments();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdminContext, open]);

  useEffect(() => {
    if (!isSuperAdminContext || !open) {
      return;
    }

    let cancelled = false;

    const loadSuperBatches = async () => {
      const scopedCollegeIds = form.allColleges
        ? (colleges || []).map((item) => item.id)
        : (Array.isArray(form.collegeIds) ? form.collegeIds : []);

      if (!scopedCollegeIds.length) {
        if (!cancelled) {
          setSuperBatches([]);
        }
        return;
      }

      try {
        const responses = await Promise.all(
          scopedCollegeIds.map((collegeId) => superAdminApi.getBatches(`?page=1&limit=100&collegeId=${collegeId}`))
        );
        const merged = responses.flatMap((result) => (Array.isArray(result?.data) ? result.data : []));
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        if (!cancelled) {
          setSuperBatches(deduped);
        }
      } catch {
        if (!cancelled) {
          setSuperBatches([]);
        }
      }
    };

    loadSuperBatches();

    return () => {
      cancelled = true;
    };
  }, [colleges, form.allColleges, form.collegeIds, isSuperAdminContext, open]);

  useEffect(() => {
    if (isSuperAdminContext || !open || step !== 3 || form.questionInputMode !== "question_bank") {
      return;
    }

    const selectedSubject = qb.filters.subjectId || qb.subjects[0]?.id;
    if (!selectedSubject) {
      return;
    }

    if (!qb.filters.subjectId && qb.subjects[0]?.id) {
      dispatch(setQuestionBankFilters({ subjectId: qb.subjects[0].id }));
    }

    dispatch(
      fetchQuestionBankQuestions({
        filters: { ...qb.filters, subjectId: selectedSubject },
        page: qbPage,
        limit: qb.pagination.limit,
      })
    );
  }, [dispatch, form.questionInputMode, isSuperAdminContext, open, qb.filters, qb.pagination.limit, qb.subjects, qbPage, step]);

  useEffect(() => {
    if (!open) return undefined;

    const onStorage = (event) => {
      if (event.key === draftKey && event.newValue && event.newValue !== JSON.stringify(form)) {
        setExternalDraftWarning(true);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [draftKey, open, form]);

  const canProceed = useMemo(() => Object.keys(validateCurrentStep(testCreation)).length === 0, [testCreation]);

  const filteredBatches = useMemo(() => {
    if (!form.departmentId) return batches;
    return batches.filter((batch) => String(batch.departmentId || "") === String(form.departmentId));
  }, [batches, form.departmentId]);

  const scopedSuperDepartments = useMemo(() => {
    return superDepartments.filter((department) => {
      if (!form.allColleges && Array.isArray(form.collegeIds) && form.collegeIds.length > 0 && !form.collegeIds.includes(department.collegeId)) {
        return false;
      }
      return true;
    });
  }, [form.allColleges, form.collegeIds, superDepartments]);

  const visibleSuperBatches = useMemo(() => {
    if (form.assignmentMethod !== "batch_wise") return [];
    return superBatches.filter((batch) => {
      if (!form.allColleges && Array.isArray(form.collegeIds) && form.collegeIds.length > 0 && !form.collegeIds.includes(batch.collegeId)) {
        return false;
      }
      if (Array.isArray(form.departmentIds) && form.departmentIds.length > 0) {
        return form.departmentIds.includes(batch.departmentId);
      }
      return true;
    });
  }, [form.allColleges, form.assignmentMethod, form.collegeIds, form.departmentIds, superBatches]);

  const groupedDepartmentsByCollege = useMemo(() => {
    return scopedSuperDepartments.reduce((acc, department) => {
      const key = department.collegeId || "unknown";
      if (!acc[key]) {
        acc[key] = {
          collegeId: key,
          collegeName: department.college?.name || "Unknown college",
          items: [],
        };
      }
      acc[key].items.push(department);
      return acc;
    }, {});
  }, [scopedSuperDepartments]);

  const groupedBatchesByCollege = useMemo(() => {
    return visibleSuperBatches.reduce((acc, batch) => {
      const key = batch.collegeId || "unknown";
      if (!acc[key]) {
        acc[key] = {
          collegeId: key,
          collegeName: batch.college?.name || "Unknown college",
          items: [],
        };
      }
      acc[key].items.push(batch);
      return acc;
    }, {});
  }, [visibleSuperBatches]);

  const normalizedQuestions = useMemo(() => {
    return form.questions.map((question, idx) => {
      const type = String(question.type || "mcq").toLowerCase();
      const text = String(question.question || "").trim();
      const options = Array.isArray(question.options) ? question.options.map((item) => String(item).trim()).filter(Boolean) : [];
      const correctAnswer = typeof question.correctAnswer === "string" ? question.correctAnswer.trim() : question.correctAnswer;
      const marks = Number(question.marks || 0);
      const difficulty = ["EASY", "MEDIUM", "HARD"].includes(String(question.difficulty || "").toUpperCase())
        ? String(question.difficulty).toUpperCase()
        : "MEDIUM";
      const topic = String(question.topic || "").trim();

      let hasError = !text || marks <= 0;
      if (type === "mcq") hasError = hasError || options.length < 2 || !options.includes(String(correctAnswer));
      if (type === "true_false") hasError = hasError || typeof correctAnswer !== "boolean";
      if (["fill_blank", "paragraph"].includes(type)) hasError = hasError || !String(correctAnswer || "").trim();

      return {
        index: idx,
        type,
        text,
        options,
        correctAnswer,
        marks,
        difficulty,
        topic,
        hasError,
      };
    });
  }, [form.questions]);

  const reviewSummary = useMemo(() => {
    const totalQuestions = normalizedQuestions.length;
    const totalMarks = normalizedQuestions.reduce((sum, item) => sum + item.marks, 0);
    const byType = normalizedQuestions.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    const difficulty = normalizedQuestions.reduce((acc, item) => {
      acc[item.difficulty] = (acc[item.difficulty] || 0) + 1;
      return acc;
    }, { EASY: 0, MEDIUM: 0, HARD: 0 });
    const topic = normalizedQuestions.reduce((acc, item) => {
      const key = item.topic || "Untagged";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const avgMarks = totalQuestions ? Number((totalMarks / totalQuestions).toFixed(2)) : 0;
    const timePerQuestion = totalQuestions ? Number((Number(form.durationMins || 0) / totalQuestions).toFixed(2)) : 0;
    const invalidIndexes = normalizedQuestions.filter((item) => item.hasError).map((item) => item.index + 1);
    const warnings = [];
    if (timePerQuestion > 0 && timePerQuestion < 1) warnings.push("Too many questions for the configured duration.");
    if (normalizedQuestions.some((item) => !item.topic)) warnings.push("Some questions are missing topic tags.");
    if (form.shuffleQuestions && normalizedQuestions.some((item) => item.type === "true_false")) warnings.push("True/False with question shuffle can increase accidental mismatches.");
    if (Number(form.restrictions.violationThreshold || 0) > 8) warnings.push("High violation threshold may allow repeated cheating behavior.");
    if (form.restrictions.devtoolsDetection && /code|programming|algorithm/i.test(String(form.subject || ""))) {
      warnings.push("Devtools detection enabled for coding-oriented test. Verify policy intent.");
    }

    return {
      totalQuestions,
      totalMarks,
      byType,
      difficulty,
      topic,
      avgMarks,
      timePerQuestion,
      invalidIndexes,
      warnings,
    };
  }, [normalizedQuestions, form.durationMins, form.shuffleQuestions, form.restrictions.devtoolsDetection, form.restrictions.violationThreshold, form.subject]);

  const assignedStudentsCount = useMemo(() => {
    if (!Array.isArray(students) || students.length === 0) return 0;
    if (form.assignmentMethod === "batch_wise") {
      return students.filter((student) => form.batchIds.includes(student.batchId)).length;
    }
    if (form.departmentId) {
      return students.filter((student) => student.departmentId === form.departmentId).length;
    }
    return students.length;
  }, [students, form.assignmentMethod, form.batchIds, form.departmentId]);

  const publishChecklist = useMemo(() => {
    const scheduleValid = Boolean(form.startsAt && form.endsAt && new Date(form.endsAt).getTime() > new Date(form.startsAt).getTime());
    const studentsAssigned = form.assignmentMethod === "batch_wise" ? form.batchIds.length > 0 : true;
    const noErrors = reviewSummary.invalidIndexes.length === 0;
    const proctoringSet = Number(form.restrictions.violationThreshold || 0) >= 1;
    return [
      { label: "Test name exists", done: Boolean(String(form.name || "").trim()) },
      { label: "Schedule valid", done: scheduleValid },
      { label: "Students assigned", done: studentsAssigned },
      { label: "Questions added", done: reviewSummary.totalQuestions > 0 },
      { label: "No question errors", done: noErrors },
      { label: "Proctoring set", done: proctoringSet },
    ];
  }, [form, reviewSummary.invalidIndexes.length, reviewSummary.totalQuestions]);

  const getFirstErrorMessage = (nextErrors) => Object.values(nextErrors || {}).find(Boolean) || "Please complete required fields";

  const applyCurrentStepValidation = () => {
    const nextErrors = validateCurrentStep(testCreation);
    dispatch(setTestCreationErrors(nextErrors));
    return nextErrors;
  };

  const validateAllSteps = (stateSnapshot = testCreation) => {
    const allErrors = {};
    for (let currentStep = 0; currentStep < stepTitles.length - 1; currentStep += 1) {
      Object.assign(allErrors, validateCurrentStep({ ...stateSnapshot, step: currentStep }));
    }
    return allErrors;
  };

  const handleClose = () => {
    dispatch(clearTestCreationErrors());
    dispatch(setDialogOpenState(false));
  };

  const handleStepJump = (targetStep) => {
    if (targetStep <= step) {
      dispatch(setTestCreationStep(targetStep));
      return;
    }

    const nextErrors = applyCurrentStepValidation();
    if (Object.keys(nextErrors).length) {
      toast.error(getFirstErrorMessage(nextErrors));
      return;
    }

    dispatch(clearTestCreationErrors());
    dispatch(setTestCreationStep(targetStep));
  };

  const handleContinue = () => {
    const nextErrors = applyCurrentStepValidation();
    if (Object.keys(nextErrors).length) {
      toast.error(getFirstErrorMessage(nextErrors));
      return;
    }

    dispatch(clearTestCreationErrors());
    dispatch(goToNextCreationStep());
  };

  const parseBulkQuestion = (question) => {
    const type = String(question?.type || "mcq").toLowerCase();
    const normalized = {
      type,
      question: String(question?.question || "").trim(),
      options: Array.isArray(question?.options)
        ? question.options.map((option) => String(option).trim()).filter(Boolean)
        : [],
      correctAnswer: question?.correctAnswer,
      marks: Number(question?.marks || 1),
    };

    if (type === "mcq") {
      normalized.correctAnswer = String(question?.correctAnswer || "").trim();
      return normalized;
    }

    if (type === "true_false") {
      if (typeof question?.correctAnswer === "boolean") {
        normalized.correctAnswer = question.correctAnswer;
        return normalized;
      }
      normalized.correctAnswer = String(question?.correctAnswer).toLowerCase() === "true";
      return normalized;
    }

    normalized.correctAnswer = String(question?.correctAnswer || "").trim();
    return normalized;
  };

  const handleApplyBulkJson = () => {
    try {
      const parsed = JSON.parse(bulkJson);
      if (!Array.isArray(parsed)) {
        toast.error("Bulk JSON must be an array of questions");
        return;
      }

      const questions = parsed.map(parseBulkQuestion);
      dispatch(replaceQuestionsFromBulk(questions));
      dispatch(clearTestCreationErrors());
      toast.success(`Imported ${questions.length} questions`);
    } catch {
      toast.error("Invalid JSON format");
    }
  };

  const handleSubmit = async (formOverrides = {}) => {
    const nextForm = { ...form, ...formOverrides };
    const nextState = { ...testCreation, form: nextForm };

    const allErrors = validateAllSteps(nextState);
    dispatch(setTestCreationErrors(allErrors));
    if (Object.keys(allErrors).length) {
      const firstInvalidStep = Array.from({ length: stepTitles.length - 1 }).find((candidateStep) =>
        Object.keys(validateCurrentStep({ ...nextState, step: candidateStep })).length
      );
      if (typeof firstInvalidStep === "number") {
        dispatch(setTestCreationStep(firstInvalidStep));
      }
      toast.error(getFirstErrorMessage(allErrors));
      return;
    }

    Object.entries(formOverrides).forEach(([key, value]) => {
      dispatch(updateTestCreationField({ key, value }));
    });

    try {
      await dispatch(submitTestCreation()).unwrap();
      if (isSuperAdminContext) {
        if (typeof onCreated === "function") {
          await onCreated();
        }
      } else {
        dispatch(fetchAdminTests());
      }
      localStorage.removeItem(draftKey);
      toast.success("Test created successfully");
    } catch (error) {
      const message = String(error || "Failed to create test");
      if (message.includes("Overlapping active test detected")) {
        if (!nextForm.skipOverlapCheck) {
          dispatch(updateTestCreationField({ key: "skipOverlapCheck", value: true }));
        }
        dispatch(setTestCreationStep(1));
        toast.error("Overlapping active test detected. 'Allow overlapping active tests' is now enabled. Review schedule, then publish again if intentional.");
        return;
      }
      toast.error(message);
    }
  };

  const onPrevious = () => dispatch(goToPreviousCreationStep());

  const onNext = () => handleContinue();

  const onSubmit = async (publishState) => {
    if (isSubmitting) {
      return;
    }

    const checklistFailed = publishChecklist.some((item) => !item.done);
    if (publishState !== "DRAFT" && checklistFailed) {
      toast.error("Complete pre-publish checklist before publishing.");
      return;
    }

    if (publishState !== "DRAFT") {
      const nextForm = {
        ...form,
        publishState: publishState || form.publishState,
        skipOverlapCheck: Boolean(form.skipOverlapCheck),
      };
      const nextState = { ...testCreation, form: nextForm };
      const allErrors = validateAllSteps(nextState);
      dispatch(setTestCreationErrors(allErrors));
      if (Object.keys(allErrors).length) {
        const firstInvalidStep = Array.from({ length: stepTitles.length - 1 }).find((candidateStep) =>
          Object.keys(validateCurrentStep({ ...nextState, step: candidateStep })).length
        );
        if (typeof firstInvalidStep === "number") {
          dispatch(setTestCreationStep(firstInvalidStep));
        }
        toast.error(getFirstErrorMessage(allErrors));
        return;
      }

      setPublishDialog({ open: true, publishState: publishState || form.publishState });
      return;
    }

    const overrides = {};
    if (publishState && publishState !== form.publishState) {
      overrides.publishState = publishState;
    }
    if ((publishState || form.publishState) === "DRAFT") {
      overrides.skipOverlapCheck = true;
    }
    await handleSubmit(overrides);
  };

  const confirmPublish = async () => {
    if (isConfirmPublishing || isSubmitting) {
      return;
    }

    const selectedPublishState = publishDialog.publishState || form.publishState;
    setIsConfirmPublishing(true);

    try {
      setPublishDialog((prev) => ({ ...prev, open: false }));
      resetBodyInteractionLock();
      await handleSubmit({ publishState: selectedPublishState, skipOverlapCheck: Boolean(form.skipOverlapCheck) });
    } finally {
      setIsConfirmPublishing(false);
      resetBodyInteractionLock();
    }
  };

  const handleQuestionInputModeChange = (mode) => {
    dispatch(setQuestionInputMode(mode));
    if (mode === "bulk_json") {
      setBulkJson(JSON.stringify(form.questions, null, 2));
    }
  };

  const updateQuestionOption = (index, optionIndex, value) => {
    const options = [...(form.questions[index]?.options || [])];
    options[optionIndex] = value;
    dispatch(updateQuestionRow({ index, patch: { options } }));
  };

  const addQuestionOption = (index) => {
    const options = [...(form.questions[index]?.options || []), ""];
    dispatch(updateQuestionRow({ index, patch: { options } }));
  };

  const removeQuestionOption = (index, optionIndex) => {
    const options = (form.questions[index]?.options || []).filter((_, idx) => idx !== optionIndex);
    dispatch(updateQuestionRow({ index, patch: { options } }));
  };

  const resolvedPrimaryPublishState = form.publishState && form.publishState !== "DRAFT"
    ? form.publishState
    : "PUBLISH_NOW";

  if (!open) return (
    <Button onClick={() => dispatch(openTestCreationDialog())} className="bg-blue-600 hover:bg-blue-700">
      Create Test
    </Button>
  );

  return (
    // --- OVERLAY WRAPPER ---
    <div className="fixed inset-0 z-100 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* --- MODAL CONTAINER (The Overlay Box) --- */}
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-100">
        
        {/* Close Button */}
        <button 
          onClick={handleClose}
          className="absolute right-4 top-4 z-50 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:right-6 lg:top-6"
        >
          <X size={20} />
        </button>

        <header className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6 lg:px-8">
          <div className="pr-12">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Create Test</h2>
                <p className="max-w-3xl text-sm text-slate-500">
                  Build, review, and publish assessments from a full-page workspace with guided steps and live preview.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:min-w-95">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current Step</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {step + 1} / {stepTitles.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{stepTitles[step]}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Questions</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{form.questions.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Ready for assessment flow</p>
                </div>
                <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md sm:col-span-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Assigned Batches</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{form.batchIds.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Audience currently selected</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          <aside className="order-1 hidden border-r border-slate-200 bg-white px-4 py-6 lg:col-span-2 lg:block">
            <div className="space-y-3">
              {stepTitles.map((title, index) => {
                const isActive = step === index;
                const isCompleted = index < step;

                return (
                  <button
                    key={title}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleStepJump(index)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                      isActive
                        ? "border-blue-600 bg-blue-50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : isCompleted
                            ? "bg-emerald-600 text-white"
                            : "bg-white text-slate-500"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="text-sm font-medium text-slate-700">{title}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* --- RIGHT PREVIEW PANEL --- */}
          <aside className="order-3 border-t border-slate-200 bg-slate-50/70 p-4 sm:p-6 lg:col-span-3 lg:order-3 lg:border-l lg:border-t-0 lg:p-6">
            <div className="lg:sticky lg:top-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Live Preview</h2>
                    <p className="mt-1 text-sm text-slate-500">A running summary of the test you are shaping.</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    {stepTitles[step]}
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Test Name</p>
                    <p className="wrap-break-word text-base font-semibold text-slate-900">{form.name || "Untitled Test"}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Subject</p>
                    <p className="wrap-break-word text-sm text-slate-700">{form.subject || "No subject selected"}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition-all duration-200 hover:bg-white">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Duration</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{form.durationMins || 0} mins</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition-all duration-200 hover:bg-white">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Questions</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{form.questions.length}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition-all duration-200 hover:bg-white">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Assigned Batches</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{form.batchIds.length}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition-all duration-200 hover:bg-white">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Publish Mode</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">{form.publishState}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Auto-save enabled</p>
                    <p className="mt-1 text-xs text-blue-600">Your progress is saved locally in this browser.</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* --- RIGHT CONTENT AREA --- */}
          <main className="order-2 flex min-w-0 flex-1 flex-col overflow-hidden lg:col-span-7 lg:order-2">
            <header className="border-b border-slate-200 bg-white px-4 py-4 lg:hidden">
              <h3 className="text-lg font-semibold text-slate-900">{stepTitles[step]}</h3>
            </header>

          {/* Scrollable Form Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
            <div className="space-y-6">
              
              {/* Step 0: Basic Info */}
              {step === 0 && (
                <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                  <header className="space-y-2">
                    <h1 className="text-lg font-semibold text-slate-900">Basic Information</h1>
                    <p className="text-sm text-slate-500">Define the core identity of your test.</p>
                  </header>
                  <div className="grid gap-6">
                    <div className="grid space-y-2">
                      <label className="text-sm text-gray-600">Test Title</label>
                      <Input 
                        className="max-w-lg"
                        placeholder="e.g. End Semester Theory" 
                        value={form.name} 
                        onChange={(e) => dispatch(updateTestCreationField({ key: "name", value: e.target.value }))}
                      />
                      {errors.name ? <p className="text-xs text-red-600">{errors.name}</p> : null}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-gray-600">Description</label>
                      <Textarea
                        className="max-w-2xl"
                        rows={4}
                        placeholder="Add short instructions or topic coverage for this test"
                        value={form.description}
                        onChange={(e) => dispatch(updateTestCreationField({ key: "description", value: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-gray-600">Subject Category</label>
                      <Select value={form.subject} onValueChange={(v) => dispatch(updateTestCreationField({ key: "subject", value: v }))}>
                        <SelectTrigger className="max-w-md"><SelectValue placeholder="Select a subject" /></SelectTrigger>
                        <SelectContent>
                          {SUBJECT_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {errors.subject ? <p className="text-xs text-red-600">{errors.subject}</p> : null}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm text-gray-600">Total Marks</label>
                        <Input className="max-w-md" type="text" value={form.totalMarks} onChange={(e) => dispatch(updateTestCreationField({ key: "totalMarks", value: Number(e.target.value) }))} />
                        {errors.totalMarks ? <p className="text-xs text-red-600">{errors.totalMarks}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-gray-600">Duration (Mins)</label>
                        <Input className="max-w-md" type="number" value={form.durationMins} onChange={(e) => dispatch(updateTestCreationField({ key: "durationMins", value: Number(e.target.value) }))} />
                        {errors.durationMins ? <p className="text-xs text-red-600">{errors.durationMins}</p> : null}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {step === 1 && (
                <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Clock className="h-5 w-5 text-blue-600" /> Timing & Attempts</h1>
                    <p className="text-sm text-slate-500">Set schedule and attempt evaluation rules.</p>
                  </header>

                  <div className="grid gap-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm text-gray-600">Starts At</label>
                        <Input
                          className="max-w-md"
                          type="datetime-local"
                          value={form.startsAt}
                          onChange={(e) => dispatch(updateTestCreationField({ key: "startsAt", value: e.target.value }))}
                        />
                        {errors.startsAt ? <p className="text-xs text-red-600">{errors.startsAt}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-gray-600">Ends At</label>
                        <Input
                          className="max-w-md"
                          type="datetime-local"
                          value={form.endsAt}
                          onChange={(e) => dispatch(updateTestCreationField({ key: "endsAt", value: e.target.value }))}
                        />
                        {errors.endsAt ? <p className="text-xs text-red-600">{errors.endsAt}</p> : null}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm text-gray-600">Attempts Allowed</label>
                        <Input
                          className="max-w-md"
                          type="number"
                          min={1}
                          max={10}
                          value={form.attemptsAllowed}
                          onChange={(e) => dispatch(updateTestCreationField({ key: "attemptsAllowed", value: Number(e.target.value) }))}
                        />
                        {errors.attemptsAllowed ? <p className="text-xs text-red-600">{errors.attemptsAllowed}</p> : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm text-gray-600">Evaluation Rule</label>
                        <Select
                          value={form.evaluationRule}
                          onValueChange={(value) => dispatch(updateTestCreationField({ key: "evaluationRule", value }))}
                        >
                          <SelectTrigger className="max-w-md"><SelectValue placeholder="Select rule" /></SelectTrigger>
                          <SelectContent>
                            {EVALUATION_RULE_OPTIONS.map((item) => (
                              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm text-gray-600">Overlap Policy</label>
                      <label className="flex max-w-md items-center justify-between rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-slate-700">
                        <span>
                          Allow overlapping active tests
                          <span className="mt-1 block text-xs text-slate-500">Use only if overlapping schedules are intentionally required.</span>
                        </span>
                        <Checkbox
                          checked={Boolean(form.skipOverlapCheck)}
                          onCheckedChange={(checked) => dispatch(updateTestCreationField({ key: "skipOverlapCheck", value: checked === true }))}
                        />
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Users className="h-5 w-5 text-blue-600" /> Assignment</h1>
                    <p className="text-sm text-slate-500">Choose one audience method: department-wise or batch-wise.</p>
                  </header>

                  <div className="space-y-6">
                    {isSuperAdminContext ? (
                      <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                        <p className="text-sm font-semibold text-blue-900">Super Admin Targeting</p>
                        <div className="grid gap-2 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => dispatch(updateTestCreationField({ key: "assignmentMethod", value: "department_wise" }))}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "department_wise"
                                ? "border-blue-500 bg-blue-100"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <p className="text-sm font-semibold text-slate-900">Department-wise</p>
                            <p className="mt-1 text-xs text-slate-500">Assign by department across selected colleges.</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => dispatch(updateTestCreationField({ key: "assignmentMethod", value: "batch_wise" }))}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "batch_wise"
                                ? "border-blue-500 bg-blue-100"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <p className="text-sm font-semibold text-slate-900">Batch-wise</p>
                            <p className="mt-1 text-xs text-slate-500">Assign to specific batches in selected colleges.</p>
                          </button>
                        </div>

                        <label className="flex items-center gap-2 text-sm text-blue-900">
                          <input
                            type="checkbox"
                            checked={Boolean(form.allColleges)}
                            onChange={(event) => dispatch(updateTestCreationField({ key: "allColleges", value: event.target.checked }))}
                          />
                          Assign to all colleges
                        </label>
                        {!form.allColleges ? (
                          <div className="space-y-2">
                            <label className="text-sm text-blue-900">Select colleges</label>
                            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-blue-200 bg-white p-3">
                              {colleges.map((college) => (
                                <label key={college.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                  <span>{college.name}</span>
                                  <Checkbox
                                    checked={Array.isArray(form.collegeIds) && form.collegeIds.includes(college.id)}
                                    onCheckedChange={(checked) => {
                                      const existing = Array.isArray(form.collegeIds) ? form.collegeIds : [];
                                      const next = checked
                                        ? [...new Set([...existing, college.id])]
                                        : existing.filter((id) => id !== college.id);
                                      dispatch(updateTestCreationField({ key: "collegeIds", value: next }));
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                            {errors.collegeIds ? <p className="text-xs text-red-600">{errors.collegeIds}</p> : null}
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          <label className="text-sm text-blue-900">Departments (checkbox)</label>
                          <div className="max-h-60 space-y-3 overflow-y-auto rounded-xl border border-blue-200 bg-white p-3">
                            {Object.values(groupedDepartmentsByCollege).map((group) => (
                              <div key={group.collegeId} className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.collegeName}</p>
                                {group.items.map((department) => (
                                  <label key={department.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                    <span>{department.name} <span className="text-xs text-slate-500">(Students: {department?._count?.students || 0})</span></span>
                                    <Checkbox
                                      checked={Array.isArray(form.departmentIds) && form.departmentIds.includes(department.id)}
                                      onCheckedChange={(checked) => {
                                        const existing = Array.isArray(form.departmentIds) ? form.departmentIds : [];
                                        const next = checked === true
                                          ? [...new Set([...existing, department.id])]
                                          : existing.filter((id) => id !== department.id);
                                        dispatch(updateTestCreationField({ key: "departmentIds", value: next }));
                                      }}
                                    />
                                  </label>
                                ))}
                              </div>
                            ))}
                            {scopedSuperDepartments.length === 0 ? <p className="px-1 py-2 text-xs text-slate-500">No departments available for current college scope.</p> : null}
                          </div>
                        </div>

                        {form.assignmentMethod === "batch_wise" ? (
                          <div className="space-y-2">
                            <label className="text-sm text-blue-900">Batches (checkbox)</label>
                            <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-blue-200 bg-white p-3">
                              {Object.values(groupedBatchesByCollege).map((group) => (
                                <div key={group.collegeId} className="space-y-2">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.collegeName}</p>
                                  {group.items.map((batch) => (
                                    <label key={batch.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                      <span>{batch.name} <span className="text-xs text-slate-500">({batch.department?.name || "-"} / Students: {batch?._count?.students || 0})</span></span>
                                      <Checkbox
                                        checked={Array.isArray(form.batchIds) && form.batchIds.includes(batch.id)}
                                        onCheckedChange={(checked) => {
                                          const existing = Array.isArray(form.batchIds) ? form.batchIds : [];
                                          const next = checked === true
                                            ? [...new Set([...existing, batch.id])]
                                            : existing.filter((id) => id !== batch.id);
                                          dispatch(updateTestCreationField({ key: "batchIds", value: next }));
                                        }}
                                      />
                                    </label>
                                  ))}
                                </div>
                              ))}
                              {visibleSuperBatches.length === 0 ? <p className="px-1 py-2 text-xs text-slate-500">No batches found for selected scope.</p> : null}
                            </div>
                            {errors.batchIds ? <p className="text-xs text-red-600">{errors.batchIds}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!isSuperAdminContext ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              dispatch(updateTestCreationField({ key: "assignmentMethod", value: "department_wise" }));
                              dispatch(updateTestCreationField({ key: "batchIds", value: [] }));
                            }}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "department_wise"
                                ? "border-blue-500 bg-blue-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <p className="text-sm font-semibold text-slate-900">Department-wise</p>
                            <p className="mt-1 text-xs text-slate-500">Assign to all batches in selected department (or all departments).</p>
                          </button>

                          <button
                            type="button"
                            onClick={() => dispatch(updateTestCreationField({ key: "assignmentMethod", value: "batch_wise" }))}
                            className={`rounded-xl border px-4 py-3 text-left transition-all ${
                              form.assignmentMethod === "batch_wise"
                                ? "border-blue-500 bg-blue-50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <p className="text-sm font-semibold text-slate-900">Batch-wise</p>
                            <p className="mt-1 text-xs text-slate-500">Manually choose one or more batches.</p>
                          </button>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm text-gray-600">Department Scope</label>
                          <Select
                            value={form.departmentId || "all"}
                            onValueChange={(value) => dispatch(updateTestCreationField({ key: "departmentId", value: value === "all" ? "" : value }))}
                          >
                            <SelectTrigger className="max-w-md"><SelectValue placeholder="Select department" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Departments</SelectItem>
                              {departments.map((department) => (
                                <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {form.assignmentMethod === "department_wise" ? (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                            This test will be assigned department-wise to all batches under <strong>{departments.find((department) => department.id === form.departmentId)?.name || "all departments"}</strong>.
                          </div>
                        ) : null}

                        {form.assignmentMethod === "batch_wise" ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-sm text-gray-600">Batches</label>
                              <span className="text-xs font-medium text-slate-500">{form.batchIds.length} selected</span>
                            </div>

                            <div className="max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                              {filteredBatches.length ? filteredBatches.map((batch) => (
                                <label key={batch.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
                                  <div>
                                    <p className="text-sm font-medium text-slate-800">{batch.name}</p>
                                    <p className="text-xs text-slate-500">Year {batch.year || "-"}</p>
                                  </div>
                                  <Checkbox
                                    checked={form.batchIds.includes(batch.id)}
                                    onCheckedChange={() => dispatch(toggleBatchId(batch.id))}
                                  />
                                </label>
                              )) : (
                                <p className="py-10 text-center text-sm text-slate-500">No batches found for selected department.</p>
                              )}
                            </div>
                            {errors.batchIds ? <p className="text-xs text-red-600">{errors.batchIds}</p> : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </section>
              )}

              {step === 3 && (
                    <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                      <header className="flex items-center justify-between">
                        <div>
                          <h1 className="text-lg font-semibold text-slate-900">Question Bank</h1>
                          <p className="text-sm text-slate-500">Add questions manually or via JSON upload.</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                          {form.questions.length} Added
                        </span>
                      </header>
                      {errors.questions ? <p className="text-sm font-medium text-red-600">{errors.questions}</p> : null}

                      <Tabs value={form.questionInputMode} onValueChange={handleQuestionInputModeChange}>
                        <TabsList className="h-auto w-full justify-start gap-2 rounded-xl bg-slate-100 p-1">
                          <TabsTrigger className="h-10 flex-none rounded-lg px-4 data-active:bg-white data-active:text-slate-900 data-active:shadow-sm" value="manual">Manual Entry</TabsTrigger>
                          <TabsTrigger className="h-10 flex-none rounded-lg px-4 data-active:bg-white data-active:text-slate-900 data-active:shadow-sm" value="bulk_json">Bulk JSON</TabsTrigger>
                          {!isSuperAdminContext ? <TabsTrigger className="h-10 flex-none rounded-lg px-4 data-active:bg-white data-active:text-slate-900 data-active:shadow-sm" value="question_bank">Question Bank</TabsTrigger> : null}
                        </TabsList>

                        <TabsContent value="manual" className="mt-6 space-y-4">
                          {form.questions.slice(0, questionRenderLimit).map((q, idx) => (
                            <div key={idx} className="group relative rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-blue-200 hover:shadow-md">
                              <div className="mb-4 flex items-center justify-between">
                                <span className="text-xs font-bold uppercase tracking-widest text-blue-600">Question {idx + 1}</span>
                                <button onClick={() => dispatch(removeQuestionRow(idx))} className="text-slate-400 hover:text-red-500">
                                  <X size={16} />
                                </button>
                              </div>
                              <Input
                                className="mb-4 text-base font-medium"
                                placeholder="Type your question here..."
                                value={q.question}
                                onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { question: e.target.value } }))}
                              />

                              <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2 md:col-span-2">
                                  <label className="text-sm text-gray-600">Question Type</label>
                                  <Select
                                    value={q.type}
                                    onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { type: value, options: value === "mcq" ? (q.options?.length ? q.options : ["", ""]) : [], correctAnswer: value === "true_false" ? false : "" } }))}
                                  >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {QUESTION_TYPE_OPTIONS.map((item) => (
                                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  <label className="text-sm text-gray-600">Marks</label>
                                  <Input
                                    type="number"
                                    min={1}
                                    value={q.marks}
                                    onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { marks: Number(e.target.value) } }))}
                                  />
                                </div>
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className="text-sm text-gray-600">Difficulty</label>
                                  <Select
                                    value={String(q.difficulty || "MEDIUM")}
                                    onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { difficulty: value } }))}
                                  >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {DIFFICULTY_OPTIONS.map((item) => (
                                        <SelectItem key={`${idx}-${item}`} value={item}>{item}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm text-gray-600">Topic Tag</label>
                                  <Input
                                    value={String(q.topic || "")}
                                    placeholder="e.g. Arrays"
                                    onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { topic: e.target.value } }))}
                                  />
                                </div>
                              </div>

                              {q.type === "mcq" && (
                                <div className="space-y-3">
                                  <p className="text-sm text-gray-600">Options</p>
                                  <div className="space-y-2">
                                    {(q.options || []).map((option, optionIndex) => (
                                      <div key={`${idx}-${optionIndex}`} className="flex gap-2">
                                        <Input
                                          value={option}
                                          placeholder={`Option ${optionIndex + 1}`}
                                          onChange={(e) => updateQuestionOption(idx, optionIndex, e.target.value)}
                                        />
                                        <Button
                                          type="button"
                                          variant="outline"
                                          onClick={() => removeQuestionOption(idx, optionIndex)}
                                          disabled={(q.options || []).length <= 2}
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                  <Button type="button" variant="outline" onClick={() => addQuestionOption(idx)}>+ Add Option</Button>

                                  <div className="space-y-2">
                                    <label className="text-sm text-gray-600">Correct Answer</label>
                                    <Select
                                      value={String(q.correctAnswer || "")}
                                      onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { correctAnswer: value } }))}
                                    >
                                      <SelectTrigger><SelectValue placeholder="Select correct option" /></SelectTrigger>
                                      <SelectContent>
                                        {(q.options || []).filter(Boolean).map((option) => (
                                          <SelectItem key={option} value={option}>{option}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )}

                              {q.type === "true_false" && (
                                <div className="space-y-2">
                                  <label className="text-sm text-gray-600">Correct Answer</label>
                                  <Select
                                    value={String(Boolean(q.correctAnswer))}
                                    onValueChange={(value) => dispatch(updateQuestionRow({ index: idx, patch: { correctAnswer: value === "true" } }))}
                                  >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="true">True</SelectItem>
                                      <SelectItem value="false">False</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}

                              {(q.type === "fill_blank" || q.type === "paragraph") && (
                                <div className="space-y-2">
                                  <label className="text-sm text-gray-600">Correct Answer</label>
                                  <Textarea
                                    rows={q.type === "paragraph" ? 4 : 2}
                                    placeholder="Add the expected answer"
                                    value={String(q.correctAnswer || "")}
                                    onChange={(e) => dispatch(updateQuestionRow({ index: idx, patch: { correctAnswer: e.target.value } }))}
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                          <Button variant="outline" className="w-full border-dashed" onClick={() => dispatch(addQuestionRow())}>
                            + Add New Question
                          </Button>
                          {questionRenderLimit < form.questions.length ? (
                            <Button
                              variant="ghost"
                              className="w-full"
                              onClick={() => dispatch(increaseQuestionRenderLimit())}
                            >
                              Load More Questions
                            </Button>
                          ) : null}
                        </TabsContent>

                        <TabsContent value="bulk_json" className="mt-6 space-y-4">
                          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                            Paste an array of questions. Each item should include: type, question, options (for mcq), correctAnswer, marks.
                          </p>
                          <Textarea
                            className="min-h-80 font-mono text-xs"
                            value={bulkJson}
                            onChange={(e) => setBulkJson(e.target.value)}
                            placeholder='[{"type":"mcq","question":"2+2?","options":["3","4"],"correctAnswer":"4","marks":1}]'
                          />
                          <Button onClick={handleApplyBulkJson}>Apply JSON</Button>
                        </TabsContent>

                        <TabsContent value="question_bank" className="mt-6 space-y-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <Select
                              value={qb.filters.subjectId || ""}
                              onValueChange={(value) => {
                                setQbPage(1);
                                dispatch(setQuestionBankFilters({ subjectId: value }));
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                              <SelectContent>
                                {qb.subjects.map((subject) => (
                                  <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Input
                              placeholder="Search question"
                              value={qb.filters.search || ""}
                              onChange={(e) => dispatch(setQuestionBankFilters({ search: e.target.value }))}
                            />

                            <Select
                              value={qb.filters.difficulty || "all"}
                              onValueChange={(value) => dispatch(setQuestionBankFilters({ difficulty: value }))}
                            >
                              <SelectTrigger><SelectValue placeholder="Difficulty" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All Difficulty</SelectItem>
                                <SelectItem value="EASY">Easy</SelectItem>
                                <SelectItem value="MEDIUM">Medium</SelectItem>
                                <SelectItem value="HARD">Hard</SelectItem>
                              </SelectContent>
                            </Select>

                            <Button
                              variant="outline"
                              onClick={() => {
                                const subjectId = qb.filters.subjectId || qb.subjects[0]?.id || "";
                                if (!subjectId) return;
                                dispatch(fetchQuestionBankQuestions({ filters: { ...qb.filters, subjectId }, page: 1, limit: qb.pagination.limit }));
                              }}
                            >
                              Apply
                            </Button>
                          </div>

                          <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
                            {qb.loading ? <p className="text-sm text-slate-500">Loading question bank...</p> : null}
                            {qb.questions.map((item) => (
                              <label key={item.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                                <Checkbox checked={qb.selected.includes(item.id)} onCheckedChange={() => dispatch(toggleQuestionBankSelected(item.id))} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900">{item.prompt}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {String(item.type || "").toLowerCase()} | {item.difficulty} | {item.marks} marks
                                  </p>
                                </div>
                              </label>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-slate-500">Selected: {qb.selected.length}</p>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                disabled={qb.pagination.page <= 1}
                                onClick={() => {
                                  const next = Math.max(1, qb.pagination.page - 1);
                                  setQbPage(next);
                                  const subjectId = qb.filters.subjectId || qb.subjects[0]?.id || "";
                                  if (!subjectId) return;
                                  dispatch(fetchQuestionBankQuestions({ filters: { ...qb.filters, subjectId }, page: next, limit: qb.pagination.limit }));
                                }}
                              >
                                Prev
                              </Button>
                              <span className="text-xs text-slate-500">{qb.pagination.page} / {qb.pagination.totalPages}</span>
                              <Button
                                variant="outline"
                                disabled={qb.pagination.page >= qb.pagination.totalPages}
                                onClick={() => {
                                  const next = qb.pagination.page + 1;
                                  setQbPage(next);
                                  const subjectId = qb.filters.subjectId || qb.subjects[0]?.id || "";
                                  if (!subjectId) return;
                                  dispatch(fetchQuestionBankQuestions({ filters: { ...qb.filters, subjectId }, page: next, limit: qb.pagination.limit }));
                                }}
                              >
                                Next
                              </Button>
                            </div>
                          </div>

                          <Button
                            onClick={() => {
                              const picked = qb.questions.filter((item) => qb.selected.includes(item.id));
                              if (picked.length === 0) {
                                toast.error("Select at least one question from bank");
                                return;
                              }
                              dispatch(addQuestionsFromBank(picked));
                              toast.success(`${picked.length} question(s) added to test`);
                            }}
                          >
                            Add to Test
                          </Button>
                        </TabsContent>
                      </Tabs>
                    </section>
                  )}

              {step === 4 && (
                <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Eye className="h-5 w-5 text-blue-600" /> Review & Validation</h1>
                    <p className="text-sm text-slate-500">Audit distribution, detect blockers, and quick-edit question metadata before proctoring setup.</p>
                  </header>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Total Questions</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{reviewSummary.totalQuestions}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Total Marks</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{reviewSummary.totalMarks}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Avg Marks / Question</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{reviewSummary.avgMarks}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Time Per Question</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{reviewSummary.timePerQuestion} min</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Question Type Mix</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {Object.entries(reviewSummary.byType).map(([type, count]) => (
                          <span key={`type-${type}`} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">{type.toUpperCase()}: {count}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-2 text-sm font-semibold text-slate-800">Difficulty Distribution</p>
                      <div className="space-y-1 text-sm text-slate-700">
                        {Object.entries(reviewSummary.difficulty).map(([key, value]) => (
                          <p key={`diff-${key}`}>{key}: <span className="font-medium">{value}</span></p>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-2 text-sm font-semibold text-slate-800">Topic Grouping</p>
                      <div className="max-h-32 space-y-1 overflow-y-auto text-sm text-slate-700">
                        {Object.entries(reviewSummary.topic).map(([key, value]) => (
                          <p key={`topic-${key}`}>{key}: <span className="font-medium">{value}</span></p>
                        ))}
                      </div>
                    </div>
                  </div>

                  {reviewSummary.invalidIndexes.length > 0 || reviewSummary.totalQuestions === 0 || reviewSummary.totalMarks === 0 ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      <p className="font-semibold">Blocking conditions found</p>
                      <ul className="mt-1 list-disc pl-5">
                        {reviewSummary.totalQuestions === 0 ? <li>No questions added.</li> : null}
                        {reviewSummary.totalMarks === 0 ? <li>Total marks is 0.</li> : null}
                        {reviewSummary.invalidIndexes.length > 0 ? <li>Fix Question {reviewSummary.invalidIndexes.join(", ")}.</li> : null}
                      </ul>
                    </div>
                  ) : null}
                  {errors.review ? <p className="text-xs text-red-600">{errors.review}</p> : null}

                  {reviewSummary.warnings.length > 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <p className="font-semibold">Warnings (non-blocking)</p>
                      <ul className="mt-1 list-disc pl-5">
                        {reviewSummary.warnings.map((item) => (<li key={item}>{item}</li>))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-800">Inline Edit Questions</h3>
                      <span className="text-xs text-slate-500">Click any question to quick edit marks, difficulty, topic, and answer.</span>
                    </div>
                    <div className="max-h-96 space-y-2 overflow-y-auto">
                      {form.questions.map((question, index) => (
                        <button
                          key={`review-inline-${index}`}
                          type="button"
                          onClick={() => setQuickEditIndex(index)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:border-blue-300 hover:bg-white"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-900">Q{index + 1}. {question.question || "Untitled question"}</p>
                            <span className="text-xs text-slate-500">{String(question.type || "mcq").toUpperCase()} • {question.marks || 0} marks</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {quickEditIndex != null && form.questions[quickEditIndex] ? (
                    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg border-l border-slate-200 bg-white p-6 shadow-2xl">
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-base font-semibold text-slate-900">Quick Edit Question {quickEditIndex + 1}</h4>
                        <Button variant="ghost" size="sm" onClick={() => setQuickEditIndex(null)}>Close</Button>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm text-slate-600">Marks</label>
                          <Input type="number" min={1} value={form.questions[quickEditIndex].marks || 1} onChange={(e) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { marks: Number(e.target.value) } }))} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-slate-600">Difficulty</label>
                          <Select value={String(form.questions[quickEditIndex].difficulty || "MEDIUM")} onValueChange={(value) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { difficulty: value } }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{DIFFICULTY_OPTIONS.map((item) => <SelectItem key={`drawer-${item}`} value={item}>{item}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm text-slate-600">Topic</label>
                          <Input value={String(form.questions[quickEditIndex].topic || "")} onChange={(e) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { topic: e.target.value } }))} />
                        </div>
                        {form.questions[quickEditIndex].type === "true_false" ? (
                          <div className="space-y-2">
                            <label className="text-sm text-slate-600">Correct Answer</label>
                            <Select value={String(Boolean(form.questions[quickEditIndex].correctAnswer))} onValueChange={(value) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { correctAnswer: value === "true" } }))}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">True</SelectItem>
                                <SelectItem value="false">False</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-sm text-slate-600">Correct Answer</label>
                            <Input value={String(form.questions[quickEditIndex].correctAnswer ?? "")} onChange={(e) => dispatch(updateQuestionRow({ index: quickEditIndex, patch: { correctAnswer: e.target.value } }))} />
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </section>
              )}

              {step === 5 && (
                <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><ShieldCheck className="h-5 w-5 text-blue-600" /> Proctoring Config</h1>
                    <p className="text-sm text-slate-500">Choose a preset and customize tracking behavior.</p>
                  </header>

                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      ["STRICT_EXAM", "Strict Exam"],
                      ["STANDARD_TEST", "Standard Test"],
                      ["OPEN_ASSIGNMENT", "Open Assignment"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          dispatch(updateTestCreationField({ key: "proctoringPreset", value }));
                          Object.entries(PROCTORING_PRESETS[value]).forEach(([key, presetValue]) => {
                            dispatch(updateRestrictionsField({ key, value: presetValue }));
                          });
                        }}
                        className={`rounded-xl border px-4 py-3 text-left ${form.proctoringPreset === value ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                      >
                        <p className="text-sm font-semibold text-slate-900">{label}</p>
                        <p className="mt-1 text-xs text-slate-500">Apply and then fine-tune controls below.</p>
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                      <span className="text-sm text-slate-700">Fullscreen Required</span>
                      <Switch checked={Boolean(form.restrictions.fullscreenRequired)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "fullscreenRequired", value }))} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                      <span className="text-sm text-slate-700">Window Blur Detection</span>
                      <Switch checked={Boolean(form.restrictions.windowBlur)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "windowBlur", value }))} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                      <span className="text-sm text-slate-700">Screenshot Detection</span>
                      <Switch checked={Boolean(form.restrictions.screenshotDetection)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "screenshotDetection", value }))} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                      <span className="text-sm text-slate-700">Right Click Disabled</span>
                      <Switch checked={Boolean(form.restrictions.rightClickDisabled)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "rightClickDisabled", value }))} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                      <span className="text-sm text-slate-700">Devtools Detection</span>
                      <Switch checked={Boolean(form.restrictions.devtoolsDetection)} onCheckedChange={(value) => dispatch(updateRestrictionsField({ key: "devtoolsDetection", value }))} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                      <span className="text-sm text-slate-700">Shuffle Questions</span>
                      <Switch checked={Boolean(form.shuffleQuestions)} onCheckedChange={(value) => dispatch(updateTestCreationField({ key: "shuffleQuestions", value }))} />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-sm text-gray-600">Tab Switch</label>
                      <Select value={String(form.restrictions.tabSwitch || "monitored")} onValueChange={(value) => dispatch(updateRestrictionsField({ key: "tabSwitch", value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monitored">Monitored</SelectItem>
                          <SelectItem value="allowed">Allowed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-gray-600">Copy/Paste</label>
                      <Select value={String(form.restrictions.copyPaste || "monitored")} onValueChange={(value) => dispatch(updateRestrictionsField({ key: "copyPaste", value }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monitored">Monitored</SelectItem>
                          <SelectItem value="allowed">Allowed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-gray-600">Violation Threshold</label>
                      <Input type="number" min={1} max={20} value={form.restrictions.violationThreshold} onChange={(e) => dispatch(updateRestrictionsField({ key: "violationThreshold", value: Number(e.target.value) }))} />
                      {errors.violationThreshold ? <p className="text-xs text-red-600">{errors.violationThreshold}</p> : null}
                    </div>
                  </div>

                  {Number(form.restrictions.violationThreshold || 0) > 8 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Warning: very high violation threshold may reduce proctoring effectiveness.
                    </p>
                  ) : null}
                  {form.restrictions.devtoolsDetection && /code|programming|algorithm/i.test(String(form.subject || "")) ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Warning: devtools detection is enabled for a coding-oriented test. Confirm expected behavior.
                    </p>
                  ) : null}
                </section>
              )}

              {step === 6 && (
                <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in slide-in-from-bottom-2 hover:shadow-md lg:p-6">
                  <header className="space-y-2">
                    <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Rocket className="h-5 w-5 text-blue-600" /> Publish Flow</h1>
                    <p className="text-sm text-slate-500">Finalize status and verify readiness before publishing impact.</p>
                  </header>

                  {externalDraftWarning ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      Concurrent edit detected: this draft changed in another tab/session.
                    </div>
                  ) : null}

                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <label className="text-sm text-gray-600">Publish Option</label>
                    <Select value={form.publishState} onValueChange={(value) => dispatch(updateTestCreationField({ key: "publishState", value }))}>
                      <SelectTrigger className="max-w-md bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PUBLISH_STATE_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-slate-800">Pre-publish checklist</p>
                    <div className="space-y-2 text-sm">
                      {publishChecklist.map((item) => (
                        <p key={item.label} className={item.done ? "text-emerald-700" : "text-red-700"}>
                          {item.done ? "✓" : "✕"} {item.label}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    Publishing this test will affect <span className="font-semibold">{assignedStudentsCount}</span> students.
                  </div>
                </section>
              )}

            </div>
          </div>

          {/* --- FOOTER ACTION BAR --- */}
          <footer className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <Button 
                variant="outline" 
                onClick={onPrevious}
                disabled={step === 0 || isSubmitting}
              >
                Previous
              </Button>
              
              <div className="flex flex-wrap items-center justify-end gap-3">
                {step < stepTitles.length - 1 ? (
                  <Button 
                    className="bg-blue-600 px-8 hover:bg-blue-700" 
                    onClick={onNext}
                    disabled={!canProceed || isSubmitting}
                  >
                    Next
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onSubmit("DRAFT")}
                      disabled={isSubmitting}
                    >
                      {isSubmitting && form.publishState === "DRAFT" ? "Saving..." : "Save as Draft"}
                    </Button>

                    <Button
                      className="bg-green-600 px-8 hover:bg-green-700"
                      onClick={() => onSubmit(resolvedPrimaryPublishState)}
                      disabled={isSubmitting}
                    >
                      {isSubmitting && resolvedPrimaryPublishState !== "DRAFT" ? "Publishing..." : "Continue to Publish"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </footer>

          <AlertDialog
            open={publishDialog.open}
            onOpenChange={(open) => {
              setPublishDialog((prev) => ({ ...prev, open }));
              if (!open) {
                resetBodyInteractionLock();
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Publish</AlertDialogTitle>
                <AlertDialogDescription>
                  Publishing this test will affect {assignedStudentsCount} students. Continue?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isConfirmPublishing || isSubmitting}>Cancel</AlertDialogCancel>
                <Button onClick={confirmPublish} disabled={isConfirmPublishing || isSubmitting}>
                  {isConfirmPublishing || isSubmitting ? "Publishing..." : "Confirm Publish"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </main>
        </div>
      </div>
    </div>
  );
}

