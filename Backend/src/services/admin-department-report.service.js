const PASS_THRESHOLD_PERCENT = 40;
const { clampPercent } = require("../utils/score");

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const toPercent = (value) => clampPercent(value);

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
    select: { id: true, title: true, subject: true, totalMarks: true },
  });
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

  if (!admin?.departmentId) {
    throw new Error("Admin department not found");
  }

  const departmentId = admin.departmentId;
  const collegeId = job.collegeId;
  const batchId = filters.batchId ? String(filters.batchId) : null;
  const testId = filters.testId ? String(filters.testId) : null;

  const departmentBatches = await db.batch.findMany({
    where: { collegeId, departmentId },
    select: { id: true, name: true, academicYear: true },
  });

  const departmentBatchIds = departmentBatches.map((batch) => String(batch.id));
  const scopedBatch = batchId
    ? departmentBatches.find((batch) => String(batch.id) === batchId)
    : null;

  if (batchId && !scopedBatch) {
    throw new Error("Batch not found for this department");
  }

  const tests = await buildTestScope({
    db,
    collegeId,
    departmentId,
    batchIds: departmentBatchIds,
    testId,
  });

  const testIds = tests.map((test) => test.id);
  const testTitle = testId
    ? tests[0]?.title || "Selected Test"
    : tests.length > 1
      ? "All Tests"
      : tests[0]?.title || "All Tests";

  const studentWhere = {
    collegeId,
    departmentId,
    ...(batchId ? { OR: [{ batchId }, { batchIds: { in: [batchId] } }] } : {}),
  };

  const totalStudents = await db.student.count({ where: studentWhere });

  if (testIds.length === 0) {
    return {
      meta: {
        departmentName: admin.department?.name || "-",
        collegeName: admin.college?.name || "-",
        testTitle,
        semester: resolveSemester(filters),
        academicYear: resolveAcademicYear({ filters, batch: scopedBatch }),
        logoUrl: resolveLogoUrl(filters),
        hasSelectedTest: Boolean(testId),
      },
      kpis: {
        totalStudents,
        studentsAppeared: 0,
        studentsNotAttended: totalStudents,
        averageScore: 0,
        passPercentage: 0,
      },
      subjectPerformance: [],
      passFail: {
        passPercent: 0,
        failPercent: 0,
        passedCount: 0,
        failedCount: 0,
      },
      topPerformers: [],
      studentPerformance: [],
      weakSubjects: [],
      remarks: resolveRemarks(filters),
    };
  }

  const submissionDateFilter = buildSubmissionDateFilter(filters);

  const submissions = await db.submission.findMany({
    where: {
      collegeId,
      testId: { in: testIds },
      status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] },
      ...(submissionDateFilter ? { submittedAt: submissionDateFilter } : {}),
      user: {
        departmentId,
        ...(batchId ? { OR: [{ batchId }, { batchIds: { in: [batchId] } }] } : {}),
      },
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          studentId: true,
          enrollNumber: true,
          enrollmentNumber: true,
          year: true,
          batch: { select: { name: true, year: true, academicYear: true } },
        },
      },
      test: { select: { id: true, title: true, subject: true, totalMarks: true } },
    },
  });

  const studentBest = new Map();
  const subjectStudentBest = new Map();

  submissions.forEach((submission) => {
    const studentId = submission.user?.id || submission.userId;
    if (!studentId) return;

    const scorePercent = formatScorePercent(submission.score, submission.test?.totalMarks || 0);
    const current = studentBest.get(studentId);
    if (!current || scorePercent > current.scorePercent) {
      studentBest.set(studentId, {
        studentId,
        name: submission.user?.fullName || "Student",
        email: submission.user?.email || "-",
        year: resolveStudentYear(submission.user),
        registerNumber: getStudentNumber(submission.user),
        scorePercent,
      });
    }

    const subject = normalizeSubject(submission.test?.subject);
    if (!subjectStudentBest.has(subject)) {
      subjectStudentBest.set(subject, new Map());
    }
    const subjectMap = subjectStudentBest.get(subject);
    const existing = subjectMap.get(studentId);
    if (!existing || scorePercent > existing) {
      subjectMap.set(studentId, scorePercent);
    }
  });

  const studentsAppeared = studentBest.size;
  const studentsNotAttended = Math.max(totalStudents - studentsAppeared, 0);
  const averageScore = studentsAppeared > 0
    ? toPercent(
        Array.from(studentBest.values()).reduce((sum, row) => sum + row.scorePercent, 0) / studentsAppeared
      )
    : 0;

  const passedCount = Array.from(studentBest.values()).filter((row) => row.scorePercent >= PASS_THRESHOLD_PERCENT).length;
  const failedCount = Math.max(studentsAppeared - passedCount, 0);
  const passPercentage = studentsAppeared > 0
    ? toPercent((passedCount / studentsAppeared) * 100)
    : 0;

  const subjectPerformance = Array.from(subjectStudentBest.entries()).map(([subject, scoresMap]) => {
    const scores = Array.from(scoresMap.values());
    const avgScore = scores.length > 0 ? toPercent(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;
    return {
      subject,
      averageScore: avgScore,
    };
  }).sort((a, b) => b.averageScore - a.averageScore);

  const weakSubjects = subjectPerformance
    .slice()
    .sort((a, b) => a.averageScore - b.averageScore)
    .map((row) => ({
      subject: row.subject,
      averageScore: row.averageScore,
      status: getSubjectStatus(row.averageScore),
    }));

  return {
    meta: {
      departmentName: admin.department?.name || "-",
      collegeName: admin.college?.name || "-",
      testTitle,
      semester: resolveSemester(filters),
      academicYear: resolveAcademicYear({ filters, batch: scopedBatch }),
      logoUrl: resolveLogoUrl(filters),
      hasSelectedTest: Boolean(testId),
    },
    kpis: {
      totalStudents,
      studentsAppeared,
      studentsNotAttended,
      averageScore,
      passPercentage: passPercentage,
    },
    subjectPerformance,
    passFail: {
      passPercent: clampPercent(passPercentage),
      failPercent: clampPercent(100 - passPercentage),
      passedCount,
      failedCount,
    },
    studentPerformance: Array.from(studentBest.values())
      .sort((a, b) => b.scorePercent - a.scorePercent)
      .map((row, index) => ({
        rank: index + 1,
        studentId: row.studentId,
        name: row.name,
        email: row.email,
        year: row.year,
        registerNumber: row.registerNumber,
        scorePercent: toPercent(row.scorePercent),
      })),
    weakSubjects,
    remarks: resolveRemarks(filters),
  };
};

module.exports = {
  buildDepartmentReportPayload,
};
