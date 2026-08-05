const PASS_THRESHOLD_PERCENT = 40;
const PLACEMENT_READY_PERCENT = 60;
const { clampPercent } = require("../utils/score");
const {
  REPORTABLE_SUBMISSION_STATUSES,
  buildStudentLifecycleWhere,
  buildReportScopeMetadata,
} = require("./report-scope.service");

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const toPercent = (value) => clampPercent(value);

const round1 = (value) => Math.round(toNumber(value) * 10) / 10;

const normalizeSubject = (value) => String(value || "General").trim() || "General";
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const formatScorePercent = (score, totalMarks) => {
  const safeTotal = toNumber(totalMarks);
  const safeScore = toNumber(score);
  if (!safeTotal) return clampPercent(safeScore);
  return toPercent((safeScore / safeTotal) * 100);
};

const buildSubmissionDateFilter = (filters = {}) => {
  const range = {};
  if (filters.dateFrom) {
    range.gte = new Date(filters.dateFrom);
  }
  if (filters.dateTo) {
    range.lte = new Date(filters.dateTo);
  }
  return Object.keys(range).length > 0 ? range : null;
};

const resolveAcademicYear = ({ filters, batch }) => {
  if (filters.academicYear) return filters.academicYear;
  return batch?.academicYear || "-";
};

const resolveSemester = (filters = {}) => filters.semester || "-";

const resolveRemarks = (filters = {}) => filters.remarks || "";

const resolveLogoUrl = (filters = {}) => filters.logoUrl || "";

const resolveStudentYear = (student) => {
  const directYear = student?.year;
  if (directYear != null && directYear !== "") return directYear;
  return student?.batch?.academicYear || student?.batch?.year || "-";
};

const getSubjectStatus = (avgScore) => {
  if (avgScore < 50) return "Needs Attention";
  if (avgScore < 70) return "Moderate";
  return "Good";
};

const secondsToMinutes = (seconds) => Math.round(toNumber(seconds) / 60);

// Human-readable outcome for an in-progress / non-submitted attempt.
const describeIncompleteStatus = (status) => {
  const raw = String(status || "").toUpperCase();
  if (raw === "IN_PROGRESS") return "Opened / Not submitted";
  if (raw === "AUTO_SUBMITTED") return "Auto submitted";
  return raw ? raw.replace(/_/g, " ") : "Incomplete";
};

// Standard submission include shape so admin and super-admin fetch exactly the
// fields aggregateInstitutionReport() consumes.
const REPORT_SUBMISSION_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      studentId: true,
      enrollNumber: true,
      enrollmentNumber: true,
      year: true,
      departmentId: true,
      batch: { select: { name: true, year: true, academicYear: true } },
    },
  },
  test: { select: { id: true, title: true, subject: true, totalMarks: true } },
  violations: { select: { type: true } },
};

const REPORT_INCOMPLETE_INCLUDE = {
  user: {
    select: {
      id: true,
      fullName: true,
      studentId: true,
      enrollNumber: true,
      enrollmentNumber: true,
      departmentId: true,
    },
  },
};

const buildTestScope = async ({ db, collegeId, departmentId, batchIds, testId }) => {
  const orFilters = [];

  orFilters.push({ assignmentMethod: "everyone" });

  if (departmentId) {
    orFilters.push({ assignmentMethod: "department_wise", departmentId });
    orFilters.push({ assignmentMethod: "department_wise", assignedTo: { in: [departmentId] } });
    orFilters.push({ assignmentMethod: null, departmentId });
    orFilters.push({ assignmentMethod: null, assignedTo: { in: [departmentId] } });
  }

  if (batchIds.length > 0) {
    orFilters.push({ assignmentMethod: "batch_wise", batchId: { in: batchIds } });
    orFilters.push({ assignmentMethod: "batch_wise", batchAssignments: { some: { batchId: { in: batchIds } } } });
    orFilters.push({ assignmentMethod: "department_wise", departmentId: null, batchId: { in: batchIds } });
    orFilters.push({ assignmentMethod: "department_wise", departmentId: null, batchAssignments: { some: { batchId: { in: batchIds } } } });
    orFilters.push({ assignmentMethod: null, batchId: { in: batchIds } });
    orFilters.push({ assignmentMethod: null, batchAssignments: { some: { batchId: { in: batchIds } } } });
  }

  if (orFilters.length === 0) return [];

  const testWhere = {
    collegeId,
    OR: orFilters,
    ...(testId ? { id: testId } : {}),
  };

  return db.test.findMany({
    where: testWhere,
    select: { id: true, title: true, subject: true, totalMarks: true, durationMins: true, startsAt: true, endsAt: true },
  });
};

// Build a short deterministic report id from the job so every regenerated PDF
// for the same job carries the same reference number.
const buildReportId = (job) => {
  const created = job?.createdAt ? new Date(job.createdAt) : new Date();
  const year = Number.isFinite(created.getTime()) ? created.getFullYear() : new Date().getFullYear();
  const tail = String(job?.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase()
    .padStart(6, "0");
  return `AED-${year}-${tail}`;
};

/**
 * Pure aggregator: turns already-fetched students + submissions into the full
 * "Institution Assessment Report" payload. Shared by the admin and super-admin
 * report builders so both PDFs contain identical analytics. Does no I/O.
 */
const aggregateInstitutionReport = ({ meta, students = [], submissions = [], incompleteSubmissions = [], departmentNameById = new Map() }) => {
  const totalStudents = students.length;
  const studentById = new Map(students.map((student) => [String(student.id), student]));
  const fallbackDeptName = meta?.departmentName || "-";

  const studentBest = new Map();
  const subjectStudentBest = new Map();
  const subjectStats = new Map();
  let cheatingCases = 0;

  submissions.forEach((submission) => {
    const sid = submission.user?.id || submission.userId;
    if (!sid) return;
    const studentKey = String(sid);

    const scorePercent = formatScorePercent(submission.score, submission.test?.totalMarks || 0);
    const timeMin = secondsToMinutes(submission.timeSpentSeconds);
    const violationCount = toNumber(submission.violationCount || submission.violations?.length || 0);
    if (violationCount > 0) cheatingCases += 1;

    const deptId = String(submission.user?.departmentId || studentById.get(studentKey)?.departmentId || "");
    const deptName = departmentNameById.get(deptId) || fallbackDeptName;

    const record = {
      studentId: studentKey,
      name: submission.user?.fullName || "Student",
      email: submission.user?.email || "-",
      year: resolveStudentYear(submission.user),
      registerNumber: getStudentNumber(submission.user),
      departmentId: deptId,
      departmentName: deptName,
      scorePercent,
      timeMin,
      violations: violationCount,
      violationsByType: submission.violations || [],
    };

    const current = studentBest.get(studentKey);
    if (!current || scorePercent > current.scorePercent) {
      studentBest.set(studentKey, record);
    }

    const subject = normalizeSubject(submission.test?.subject);
    if (!subjectStudentBest.has(subject)) subjectStudentBest.set(subject, new Map());
    const subjectMap = subjectStudentBest.get(subject);
    const existing = subjectMap.get(studentKey);
    if (!existing || scorePercent > existing) subjectMap.set(studentKey, scorePercent);

    const stat = subjectStats.get(subject) || { scores: [], time: [] };
    stat.scores.push(scorePercent);
    stat.time.push(timeMin);
    subjectStats.set(subject, stat);
  });

  const bestRows = Array.from(studentBest.values());
  const studentsAppeared = bestRows.length;
  const studentsNotAttended = Math.max(totalStudents - studentsAppeared, 0);
  const scores = bestRows.map((row) => row.scorePercent);
  const times = bestRows.map((row) => row.timeMin).filter((value) => value > 0);
  const averageScore = studentsAppeared > 0 ? round1(scores.reduce((sum, value) => sum + value, 0) / studentsAppeared) : 0;
  const highestScore = scores.length ? round1(Math.max(...scores)) : 0;
  const lowestScore = scores.length ? round1(Math.min(...scores)) : 0;
  const averageTimeMin = times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : 0;

  const passedCount = bestRows.filter((row) => row.scorePercent >= PASS_THRESHOLD_PERCENT).length;
  const failedCount = bestRows.filter((row) => row.scorePercent < PASS_THRESHOLD_PERCENT).length;
  const passPercentage = studentsAppeared > 0 ? round1((passedCount / studentsAppeared) * 100) : 0;
  const placementReadyCount = bestRows.filter((row) => row.scorePercent >= PLACEMENT_READY_PERCENT).length;
  const placementReadyPercent = studentsAppeared > 0 ? round1((placementReadyCount / studentsAppeared) * 100) : 0;

  // Incomplete = opened the test but never produced a reportable submission.
  const attemptedIds = new Set(bestRows.map((row) => row.studentId));
  const incompleteStudents = incompleteSubmissions
    .filter((submission) => !attemptedIds.has(String(submission.user?.id || submission.userId)))
    .map((submission) => ({
      name: submission.user?.fullName || "Student",
      registerNumber: getStudentNumber(submission.user),
      department: departmentNameById.get(String(submission.user?.departmentId)) || fallbackDeptName,
      status: describeIncompleteStatus(submission.status),
    }));

  const subjectPerformance = Array.from(subjectStudentBest.entries())
    .map(([subject, scoresMap]) => {
      const values = Array.from(scoresMap.values());
      const stat = subjectStats.get(subject) || { time: [] };
      const avgScore = values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      const timeValues = (stat.time || []).filter((value) => value > 0);
      return {
        subject,
        averageScore: avgScore,
        highest: values.length ? round1(Math.max(...values)) : 0,
        lowest: values.length ? round1(Math.min(...values)) : 0,
        avgTimeMin: timeValues.length ? Math.round(timeValues.reduce((sum, value) => sum + value, 0) / timeValues.length) : 0,
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore);

  const weakSubjects = subjectPerformance
    .slice()
    .sort((a, b) => a.averageScore - b.averageScore)
    .map((row) => ({ subject: row.subject, averageScore: row.averageScore, status: getSubjectStatus(row.averageScore) }));
  const strongSubjects = subjectPerformance.slice(0, 5);

  // Per-department comparison (one row for a department-scoped report, many for
  // a college-wide scope).
  const departmentAgg = new Map();
  const ensureDept = (id, name) => {
    const key = String(id || "");
    if (!departmentAgg.has(key)) {
      departmentAgg.set(key, { departmentId: key, departmentName: name || fallbackDeptName, registered: 0, scores: [], times: [], passed: 0, placement: 0 });
    }
    return departmentAgg.get(key);
  };
  students.forEach((student) => {
    const key = String(student.departmentId || "");
    ensureDept(key, departmentNameById.get(key) || fallbackDeptName).registered += 1;
  });
  bestRows.forEach((row) => {
    const bucket = ensureDept(row.departmentId, row.departmentName);
    bucket.scores.push(row.scorePercent);
    if (row.timeMin > 0) bucket.times.push(row.timeMin);
    if (row.scorePercent >= PASS_THRESHOLD_PERCENT) bucket.passed += 1;
    if (row.scorePercent >= PLACEMENT_READY_PERCENT) bucket.placement += 1;
  });
  const departmentPerformance = Array.from(departmentAgg.values())
    .map((bucket) => {
      const attempted = bucket.scores.length;
      const avg = attempted ? round1(bucket.scores.reduce((sum, value) => sum + value, 0) / attempted) : 0;
      return {
        departmentName: bucket.departmentName,
        registered: bucket.registered,
        attempted,
        notAttended: Math.max(bucket.registered - attempted, 0),
        passed: bucket.passed,
        failed: Math.max(attempted - bucket.passed, 0),
        averageScore: avg,
        highest: attempted ? round1(Math.max(...bucket.scores)) : 0,
        participation: bucket.registered ? round1((attempted / bucket.registered) * 100) : 0,
        passRate: attempted ? round1((bucket.passed / attempted) * 100) : 0,
        placementReady: attempted ? round1((bucket.placement / attempted) * 100) : 0,
        avgTimeMin: bucket.times.length ? Math.round(bucket.times.reduce((sum, value) => sum + value, 0) / bucket.times.length) : 0,
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const rankedStudents = bestRows
    .slice()
    .sort((a, b) => b.scorePercent - a.scorePercent)
    .map((row, index) => ({
      rank: index + 1,
      studentId: row.studentId,
      name: row.name,
      email: row.email,
      year: row.year,
      registerNumber: row.registerNumber,
      department: row.departmentName,
      scorePercent: round1(row.scorePercent),
      accuracy: round1(row.scorePercent),
      timeMin: row.timeMin,
    }));

  const topPerformers = rankedStudents.slice(0, 20);

  // Map each below-par student to their single weakest subject for guidance.
  const subjectScoreByStudent = new Map();
  subjectStudentBest.forEach((scoresMap, subject) => {
    scoresMap.forEach((value, studentKey) => {
      const list = subjectScoreByStudent.get(studentKey) || [];
      list.push({ subject, score: value });
      subjectScoreByStudent.set(studentKey, list);
    });
  });
  const weakestSubjectFor = (studentKey) => {
    const list = subjectScoreByStudent.get(studentKey) || [];
    if (!list.length) return "-";
    return list.slice().sort((a, b) => a.score - b.score)[0].subject;
  };

  const needImprovement = rankedStudents
    .filter((row) => row.scorePercent < PASS_THRESHOLD_PERCENT)
    .map((row) => ({
      name: row.name,
      registerNumber: row.registerNumber,
      department: row.department,
      scorePercent: row.scorePercent,
      weakSubject: weakestSubjectFor(row.studentId),
      avgTimeMin: row.timeMin,
    }));

  const failedStudents = rankedStudents
    .filter((row) => row.scorePercent < PASS_THRESHOLD_PERCENT)
    .map((row) => ({ name: row.name, registerNumber: row.registerNumber, department: row.department, scorePercent: row.scorePercent }));

  // Attended students grouped by department for the complete listing.
  const attendedGroups = new Map();
  rankedStudents.forEach((row) => {
    const list = attendedGroups.get(row.department) || [];
    list.push({ name: row.name, registerNumber: row.registerNumber, scorePercent: row.scorePercent, result: row.scorePercent >= PASS_THRESHOLD_PERCENT ? "PASS" : "FAIL" });
    attendedGroups.set(row.department, list);
  });
  const attendedByDepartment = Array.from(attendedGroups.entries()).map(([department, list]) => ({ department, students: list }));

  const notAttendedStudents = students
    .filter((student) => !attemptedIds.has(String(student.id)))
    .map((student) => ({
      name: student.fullName || "Student",
      registerNumber: getStudentNumber(student),
      department: departmentNameById.get(String(student.departmentId)) || fallbackDeptName,
      year: resolveStudentYear(student),
    }));

  // Malpractice: per-student violation breakdown by type.
  const malpractice = bestRows
    .filter((row) => row.violations > 0)
    .map((row) => {
      const byType = {};
      (row.violationsByType || []).forEach((violation) => {
        const type = String(violation.type || "OTHER");
        byType[type] = (byType[type] || 0) + 1;
      });
      return { name: row.name, department: row.departmentName, total: row.violations, byType };
    })
    .sort((a, b) => b.total - a.total);

  return {
    meta,
    kpis: {
      totalStudents,
      studentsAppeared,
      studentsNotAttended,
      passedCount,
      failedCount,
      incompleteCount: incompleteStudents.length,
      averageScore,
      highestScore,
      lowestScore,
      averageTimeMin,
      passPercentage,
      placementReadyPercent,
      cheatingCases,
    },
    attendance: {
      attempted: studentsAppeared,
      notAttended: studentsNotAttended,
      incomplete: incompleteStudents.length,
    },
    passFail: {
      passPercent: passPercentage,
      failPercent: round1(100 - passPercentage),
      passedCount,
      failedCount,
    },
    subjectPerformance,
    weakSubjects,
    strongSubjects,
    departmentPerformance,
    topPerformers,
    needImprovement,
    notAttendedStudents,
    incompleteStudents,
    failedStudents,
    attendedByDepartment,
    malpractice,
    studentPerformance: rankedStudents,
    remarks: meta?.remarks || "",
  };
};

const buildDepartmentReportPayload = async ({ db, job }) => {
  const filters = job.filters || {};
  const admin = await db.admin.findUnique({
    where: { id: job.adminId },
    include: {
      department: { select: { id: true, name: true } },
      college: { select: { id: true, name: true } },
    },
  });

  const collegeId = job.collegeId;
  // Prefer an explicit filter department, then the admin's own department.
  // A college-wide admin (no department) falls back to a college-wide scope
  // instead of throwing, so the report renders for every panel.
  const departmentId = filters.departmentId
    ? String(filters.departmentId)
    : admin?.departmentId
      ? String(admin.departmentId)
      : null;
  const batchId = filters.batchId ? String(filters.batchId) : null;
  const testId = filters.testId ? String(filters.testId) : null;
  const year = filters.year ? Number(filters.year) : null;
  const studentLifecycleWhere = buildStudentLifecycleWhere(filters);

  const batchWhere = { collegeId, ...(departmentId ? { departmentId } : {}) };
  const scopeBatches = await db.batch.findMany({
    where: batchWhere,
    select: { id: true, name: true, academicYear: true, departmentId: true },
  });
  const scopeBatchIds = scopeBatches.map((batch) => String(batch.id));
  const scopedBatch = batchId ? scopeBatches.find((batch) => String(batch.id) === batchId) : null;

  if (batchId && !scopedBatch) {
    throw new Error("Batch not found for this department");
  }

  const departments = await db.department.findMany({
    where: { collegeId, ...(departmentId ? { id: departmentId } : {}) },
    select: { id: true, name: true },
  });
  const departmentNameById = new Map(departments.map((dept) => [String(dept.id), dept.name]));

  const tests = await buildTestScope({
    db,
    collegeId,
    departmentId,
    batchIds: scopeBatchIds,
    testId,
  });

  const testIds = tests.map((test) => test.id);
  const selectedTest = testId ? tests.find((test) => String(test.id) === testId) || tests[0] : null;
  const testTitle = testId
    ? selectedTest?.title || "Selected Test"
    : tests.length > 1
      ? "All Tests"
      : tests[0]?.title || "All Tests";
  const durationMins = selectedTest?.durationMins || (tests.length === 1 ? tests[0]?.durationMins : null) || null;
  const testDate = selectedTest?.startsAt || selectedTest?.endsAt || (tests.length === 1 ? tests[0]?.startsAt : null) || null;

  const studentWhere = {
    collegeId,
    ...(departmentId ? { departmentId } : {}),
    ...studentLifecycleWhere,
    ...(year ? { year } : {}),
    ...(batchId ? { OR: [{ batchId }, { batchIds: { in: [batchId] } }] } : {}),
  };

  const students = await db.student.findMany({
    where: studentWhere,
    include: {
      batch: { select: { name: true, year: true, academicYear: true } },
    },
  });

  const meta = {
    departmentName: departmentId ? departmentNameById.get(departmentId) || admin?.department?.name || "-" : "All Departments",
    collegeName: admin?.college?.name || "-",
    testTitle,
    subject: selectedTest?.subject || (tests.length === 1 ? tests[0]?.subject : "") || "Placement Assessment",
    semester: resolveSemester(filters),
    academicYear: resolveAcademicYear({ filters, batch: scopedBatch }),
    logoUrl: resolveLogoUrl(filters),
    hasSelectedTest: Boolean(testId),
    reportScope: buildReportScopeMetadata(filters),
    reportId: buildReportId(job),
    generatedBy: "Analytics Edify LMS",
    durationMins,
    testDate,
    departmentsCount: departments.length,
    remarks: resolveRemarks(filters),
  };

  let submissions = [];
  let incompleteSubmissions = [];
  if (testIds.length > 0) {
    const submissionDateFilter = buildSubmissionDateFilter(filters);
    const submissionUserWhere = {
      ...studentLifecycleWhere,
      ...(departmentId ? { departmentId } : {}),
      ...(year ? { year } : {}),
      ...(batchId ? { OR: [{ batchId }, { batchIds: { in: [batchId] } }] } : {}),
    };

    [submissions, incompleteSubmissions] = await Promise.all([
      db.submission.findMany({
        where: {
          collegeId,
          testId: { in: testIds },
          status: { in: REPORTABLE_SUBMISSION_STATUSES },
          ...(submissionDateFilter ? { submittedAt: submissionDateFilter } : {}),
          ...(Object.keys(submissionUserWhere).length ? { user: submissionUserWhere } : {}),
        },
        include: REPORT_SUBMISSION_INCLUDE,
      }),
      db.submission.findMany({
        where: {
          collegeId,
          testId: { in: testIds },
          status: { in: ["IN_PROGRESS"] },
          ...(Object.keys(submissionUserWhere).length ? { user: submissionUserWhere } : {}),
        },
        include: REPORT_INCOMPLETE_INCLUDE,
      }),
    ]);
  }

  return aggregateInstitutionReport({ meta, students, submissions, incompleteSubmissions, departmentNameById });
};

module.exports = {
  buildDepartmentReportPayload,
  aggregateInstitutionReport,
  buildReportId,
  REPORT_SUBMISSION_INCLUDE,
  REPORT_INCOMPLETE_INCLUDE,
};
