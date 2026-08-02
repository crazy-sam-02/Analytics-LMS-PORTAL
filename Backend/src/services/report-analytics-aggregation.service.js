const mongoose = require("mongoose");
const { withSubmissionScorePercent, toObjectIdIfValid, normalizeMongoId } = require("../utils/analytics-aggregation");
const { clampPercent } = require("../utils/score");
const { describeDistribution, PASS_THRESHOLD_PERCENT } = require("../utils/stats");

const SUBMITTED_STATUSES = ["SUBMITTED", "AUTO_SUBMITTED"];

const toIdArray = (ids) => (Array.isArray(ids) ? ids : []).map((id) => toObjectIdIfValid(id));
const getStudentNumber = (student = {}) => student.enrollNumber || student.enrollmentNumber || student.studentId || "-";

const scoreBand = (score) => {
  if (score <= 20) return "0-20";
  if (score <= 40) return "21-40";
  if (score <= 60) return "41-60";
  if (score <= 80) return "61-80";
  return "81-100";
};

/**
 * Database-side aggregation for the scoped report analytics. Replaces loading
 * up to 20k submissions into Node: Mongo computes overall metrics, monthly
 * trend, subject and department comparatives, and per-student rollups in a
 * single `$facet`. Reuses the production `withSubmissionScorePercent()` helper.
 */
async function aggregateReportSubmissions({ collegeId, testIds, studentIds, dateFrom, dateTo }) {
  const db = mongoose.connection.db;

  const match = { status: { $in: SUBMITTED_STATUSES } };
  if (collegeId) match.collegeId = toObjectIdIfValid(collegeId);
  if (Array.isArray(testIds)) match.testId = { $in: toIdArray(testIds) };
  if (Array.isArray(studentIds)) match.userId = { $in: toIdArray(studentIds) };
  const submittedAt = {};
  if (dateFrom) submittedAt.$gte = dateFrom;
  if (dateTo) submittedAt.$lte = dateTo;
  if (Object.keys(submittedAt).length) match.submittedAt = submittedAt;

  const pipeline = [
    { $match: match },
    ...withSubmissionScorePercent(),
    { $lookup: { from: "violation", localField: "_id", foreignField: "submissionId", as: "violationDocs" } },
    { $lookup: { from: "student", localField: "userId", foreignField: "_id", as: "studentDoc" } },
    { $unwind: { path: "$studentDoc", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        violationCount: { $size: { $ifNull: ["$violationDocs", []] } },
        eventDate: { $ifNull: ["$submittedAt", { $ifNull: ["$updatedAt", "$createdAt"] }] },
        isPass: { $cond: [{ $gte: ["$scorePercent", PASS_THRESHOLD_PERCENT] }, 1, 0] },
      },
    },
    {
      $facet: {
        overall: [
          {
            $group: {
              _id: null,
              totalSubmissions: { $sum: 1 },
              avgScore: { $avg: "$scorePercent" },
              passing: { $sum: "$isPass" },
              violations: { $sum: "$violationCount" },
              attemptedUsers: { $addToSet: "$userId" },
            },
          },
          { $project: { _id: 0, totalSubmissions: 1, avgScore: 1, passing: 1, violations: 1, attemptedCount: { $size: "$attemptedUsers" } } },
        ],
        byMonth: [
          { $match: { eventDate: { $type: "date" } } },
          { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$eventDate" } }, score: { $avg: "$scorePercent" } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, month: "$_id", score: 1 } },
        ],
        bySubject: [
          { $group: { _id: { $ifNull: ["$test.subject", "General"] }, score: { $avg: "$scorePercent" } } },
          { $project: { _id: 0, subject: "$_id", score: 1 } },
        ],
        byDepartment: [
          {
            $group: {
              _id: "$studentDoc.departmentId",
              submissions: { $sum: 1 },
              avgScore: { $avg: "$scorePercent" },
              passing: { $sum: "$isPass" },
              violations: { $sum: "$violationCount" },
              attemptedUsers: { $addToSet: "$userId" },
            },
          },
          { $project: { _id: 1, submissions: 1, avgScore: 1, passing: 1, violations: 1, attemptedCount: { $size: "$attemptedUsers" } } },
        ],
        byStudent: [
          {
            $group: {
              _id: "$userId",
              attempts: { $sum: 1 },
              avgScore: { $avg: "$scorePercent" },
              violations: { $sum: "$violationCount" },
            },
          },
        ],
      },
    },
  ];

  const [facet] = await db.collection("submission").aggregate(pipeline, { allowDiskUse: true }).toArray();
  return facet || { overall: [], byMonth: [], bySubject: [], byDepartment: [], byStudent: [] };
}

/**
 * Pure mapper: turns the `$facet` output plus the (bounded) Prisma student /
 * test / department metadata into the exact response shape the report page
 * expects, adding `distributionStats` (median/quartiles/std-dev). Kept pure so
 * it can be unit-tested without a database.
 */
function buildAggregateReportResponse({ facet = {}, students = [], tests = [], departments = [], filters = {} }) {
  const toPercent = (value) => clampPercent(value);
  const overall = (facet.overall && facet.overall[0]) || {
    totalSubmissions: 0,
    avgScore: 0,
    passing: 0,
    violations: 0,
    attemptedCount: 0,
  };
  const byStudent = new Map((facet.byStudent || []).map((row) => [normalizeMongoId(row._id), row]));
  const byDepartment = new Map((facet.byDepartment || []).map((row) => [normalizeMongoId(row._id), row]));
  const totalTests = tests.length;

  const studentRows = students.map((student) => {
    const agg = byStudent.get(normalizeMongoId(student.id)) || { attempts: 0, avgScore: 0, violations: 0 };
    return {
      studentId: student.id,
      name: student.fullName,
      rollNo: getStudentNumber(student),
      collegeId: student.collegeId,
      college: student.college?.name || "-",
      departmentId: student.departmentId,
      department: student.department?.name || "-",
      batch: student.batch?.name || "-",
      year: student.year || null,
      avgScore: toPercent(agg.avgScore),
      testsTaken: Number(agg.attempts || 0),
      violations: Number(agg.violations || 0),
      participation: totalTests > 0 ? toPercent((Number(agg.attempts || 0) / totalTests) * 100) : 0,
    };
  });

  const rankedStudents = studentRows
    .filter((row) => row.testsTaken > 0)
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const rankedByStudentId = new Map(rankedStudents.map((row) => [row.studentId, row]));
  const tableRows = studentRows
    .map((row) => rankedByStudentId.get(row.studentId) || { ...row, rank: null })
    .sort((a, b) => {
      if (a.rank == null && b.rank == null) return a.name.localeCompare(b.name);
      if (a.rank == null) return 1;
      if (b.rank == null) return -1;
      return a.rank - b.rank;
    });

  const totalSubmissions = Number(overall.totalSubmissions || 0);
  const attemptedStudents = Number(overall.attemptedCount || 0);
  const avgScore = toPercent(overall.avgScore || 0);
  const passRate = totalSubmissions ? toPercent((Number(overall.passing || 0) / totalSubmissions) * 100) : 0;
  const participationRate = students.length ? toPercent((attemptedStudents / students.length) * 100) : 0;
  const totalViolations = Number(overall.violations || 0);

  const scoreTrend = (facet.byMonth || []).map((row) => ({ month: row.month, score: toPercent(row.score) }));
  const subjectPerformance = (facet.bySubject || [])
    .map((row) => ({ subject: row.subject || "General", score: toPercent(row.score) }))
    .sort((a, b) => b.score - a.score);

  const distributionBase = { "0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0 };
  rankedStudents.forEach((row) => {
    distributionBase[scoreBand(row.avgScore)] += 1;
  });
  const distributionStats = describeDistribution(rankedStudents.map((row) => row.avgScore));

  const studentCountByDepartment = new Map();
  students.forEach((student) => {
    const key = normalizeMongoId(student.departmentId) || "unknown";
    studentCountByDepartment.set(key, (studentCountByDepartment.get(key) || 0) + 1);
  });

  const departmentRows = departments.map((department) => {
    const deptStudents = studentCountByDepartment.get(normalizeMongoId(department.id)) || 0;
    const agg = byDepartment.get(normalizeMongoId(department.id)) || {
      submissions: 0,
      avgScore: 0,
      passing: 0,
      violations: 0,
      attemptedCount: 0,
    };
    const submissions = Number(agg.submissions || 0);
    return {
      departmentId: department.id,
      department: department.name,
      collegeId: department.collegeId,
      college: department.college?.name || "-",
      students: deptStudents,
      submissions,
      avgScore: toPercent(agg.avgScore || 0),
      passRate: submissions ? toPercent((Number(agg.passing || 0) / submissions) * 100) : 0,
      participation: deptStudents ? toPercent((Number(agg.attemptedCount || 0) / deptStudents) * 100) : 0,
      violations: Number(agg.violations || 0),
    };
  });

  return {
    filters,
    metrics: {
      totalStudents: students.length,
      attemptedStudents,
      totalTests,
      totalSubmissions,
      avgScore,
      passRate,
      participationRate,
      violations: totalViolations,
    },
    scoreTrend,
    subjectPerformance,
    distribution: Object.entries(distributionBase).map(([range, count]) => ({ range, count })),
    distributionStats,
    departmentRows,
    tableRows,
    selectedStudent: null,
    attemptHistory: [],
  };
}

module.exports = { aggregateReportSubmissions, buildAggregateReportResponse };
