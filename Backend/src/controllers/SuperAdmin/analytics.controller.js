const mongoose = require("mongoose");
const { asyncHandler } = require("../../utils/http");

const getSuperAnalytics = asyncHandler(async (_req, res) => {
  const db = mongoose.connection.db;

  // Fetch only necessary fields using MongoDB projections for memory efficiency
  const [
    collegesRaw,
    allStudentsRaw,
    allTestsRaw,
    allSubmissionsRaw,
    allViolationsRaw,
    departmentsRaw,
  ] = await Promise.all([
    db.collection("college").find({ isActive: true }, { projection: { id: 1, name: 1, code: 1 } }).toArray(),
    db.collection("student").find({ isActive: true }, { projection: { id: 1, fullName: 1, collegeId: 1, departmentId: 1 } }).toArray(),
    db.collection("test").find({}, { projection: { id: 1, title: 1, collegeId: 1, departmentId: 1 } }).toArray(),
    db.collection("submission").find({ status: { $in: ["SUBMITTED", "AUTO_SUBMITTED"] } }, { projection: { id: 1, userId: 1, testId: 1, score: 1, status: 1, createdAt: 1, collegeId: 1 } }).toArray(),
    db.collection("violation").find({}, { projection: { id: 1, type: 1, collegeId: 1, userId: 1 } }).toArray(),
    db.collection("department").find({}, { projection: { id: 1, name: 1, collegeId: 1 } }).toArray(),
  ]);

  // Build lookups for O(1) access
  const studentMap = new Map();
  allStudentsRaw.forEach((s) => studentMap.set(s.id, s));

  const studentSubmissionsMap = new Map();
  allSubmissionsRaw.forEach((s) => {
    if (!studentSubmissionsMap.has(s.userId)) studentSubmissionsMap.set(s.userId, []);
    studentSubmissionsMap.get(s.userId).push(s);
  });

  const userViolationsMap = new Map();
  allViolationsRaw.forEach((v) => {
    userViolationsMap.set(v.userId, (userViolationsMap.get(v.userId) || 0) + 1);
  });

  // Build college-wise metrics
  const collegeMetricsMap = new Map();

  collegesRaw.forEach((college) => {
    collegeMetricsMap.set(college.id, {
      collegeId: college.id,
      collegeName: college.name || "-",
      studentCount: 0,
      totalSubmissions: 0,
      totalScore: 0,
      passingSubmissions: 0,
      totalViolations: 0,
      students: [],
      submissions: [],
      departments: new Map(),
      trend: [],
    });
  });

  // Add students to colleges
  allStudentsRaw.forEach((student) => {
    const metrics = collegeMetricsMap.get(student.collegeId);
    if (metrics) {
      metrics.students.push(student);
      metrics.studentCount += 1;
    }
  });

  // Add submissions to colleges and calculate metrics
  allSubmissionsRaw.forEach((submission) => {
    const metrics = collegeMetricsMap.get(submission.collegeId);
    if (metrics) {
      metrics.submissions.push(submission);
      metrics.totalSubmissions += 1;
      const score = Number(submission.score) || 0;
      metrics.totalScore += score;
      if (score >= 40) {
        metrics.passingSubmissions += 1;
      }
    }
  });

  // Add violations to colleges
  allViolationsRaw.forEach((violation) => {
    const metrics = collegeMetricsMap.get(violation.collegeId);
    if (metrics) {
      metrics.totalViolations += 1;
    }
  });

  // Add departments to colleges
  departmentsRaw.forEach((dept) => {
    const metrics = collegeMetricsMap.get(dept.collegeId);
    if (metrics && !metrics.departments.has(dept.id)) {
      metrics.departments.set(dept.id, {
        departmentId: dept.id,
        departmentName: dept.name || "-",
        students: [],
        submissions: [],
        totalScore: 0,
        passingSubmissions: 0,
      });
    }
  });

  // Associate students and submissions to departments
  allStudentsRaw.forEach((student) => {
    const collegeMetrics = collegeMetricsMap.get(student.collegeId);
    if (collegeMetrics && student.departmentId) {
      const deptMetrics = collegeMetrics.departments.get(student.departmentId);
      if (deptMetrics) {
        deptMetrics.students.push(student);
      }
    }
  });

  allSubmissionsRaw.forEach((submission) => {
    const student = studentMap.get(submission.userId);
    if (student) {
      const collegeMetrics = collegeMetricsMap.get(student.collegeId);
      if (collegeMetrics && student.departmentId) {
        const deptMetrics = collegeMetrics.departments.get(student.departmentId);
        if (deptMetrics) {
          deptMetrics.submissions.push(submission);
          const score = Number(submission.score) || 0;
          deptMetrics.totalScore += score;
          if (score >= 40) {
            deptMetrics.passingSubmissions += 1;
          }
        }
      }
    }
  });

  // Build trend data (grouped by month) safely
  const trendMap = new Map();
  allSubmissionsRaw.forEach((submission) => {
    if (!submission.createdAt) return;
    const date = new Date(submission.createdAt);
    if (isNaN(date.getTime())) return;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!trendMap.has(monthKey)) {
      trendMap.set(monthKey, { scores: [], count: 0 });
    }
    const trend = trendMap.get(monthKey);
    trend.scores.push(Number(submission.score) || 0);
    trend.count += 1;
  });

  const platformTrend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([month, data]) => ({
      month,
      score: data.count > 0 ? Number((data.scores.reduce((a, b) => a + b, 0) / data.count).toFixed(2)) : 0,
    }));

  // Build final college comparative data
  const collegeComparative = Array.from(collegeMetricsMap.values())
    .map((metrics) => ({
      collegeId: metrics.collegeId,
      collegeName: metrics.collegeName,
      students: metrics.studentCount,
      avgScore:
        metrics.totalSubmissions > 0
          ? Number((metrics.totalScore / metrics.totalSubmissions).toFixed(2))
          : 0,
      passRate:
        metrics.totalSubmissions > 0
          ? Number(((metrics.passingSubmissions / metrics.totalSubmissions) * 100).toFixed(2))
          : 0,
      participation:
        metrics.studentCount > 0
          ? Number(((metrics.totalSubmissions / metrics.studentCount).toFixed(2)))
          : 0,
      violations: metrics.totalViolations,
      departments: Array.from(metrics.departments.values()).map((dept) => {
        let deptViolations = 0;
        dept.students.forEach((s) => {
          deptViolations += userViolationsMap.get(s.id) || 0;
        });

        return {
          departmentName: dept.departmentName,
          avgScore:
            dept.submissions.length > 0
              ? Number((dept.totalScore / dept.submissions.length).toFixed(2))
              : 0,
          passRate:
            dept.submissions.length > 0
              ? Number(((dept.passingSubmissions / dept.submissions.length) * 100).toFixed(2))
              : 0,
          participation:
            dept.students.length > 0
              ? Number((dept.submissions.length / dept.students.length).toFixed(2))
              : 0,
          violations: deptViolations,
        };
      }),
      trend: platformTrend,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  // Build college violations breakdown
  const collegeViolations = collegeComparative.map((college) => ({
    college: college.collegeName,
    collegeName: college.collegeName,
    violations: college.violations,
  }));

  // Legacy top colleges data
  const topPerformingColleges = collegeComparative.slice(0, 10);

  // Top students data handling 0 submissions edge case
  const topStudents = allStudentsRaw
    .map((student) => {
      const studentSubmissions = studentSubmissionsMap.get(student.id) || [];
      const avgScore =
        studentSubmissions.length > 0
          ? studentSubmissions.reduce((sum, s) => sum + (Number(s.score) || 0), 0) / studentSubmissions.length
          : 0;
      return {
        studentId: student.id,
        studentName: student.fullName || "-",
        collegeName: collegesRaw.find((c) => c.id === student.collegeId)?.name || "-",
        avgScore: Number(avgScore.toFixed(2)),
      };
    })
    .filter(s => s.avgScore > 0)
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, 10);

  // Most active tests data
  const testSubmissionMap = new Map();
  allTestsRaw.forEach((test) => {
    testSubmissionMap.set(test.id, {
      testId: test.id,
      testName: test.title || "-",
      collegeId: test.collegeId,
      submissions: 0,
    });
  });

  allSubmissionsRaw.forEach((s) => {
    const tStats = testSubmissionMap.get(s.testId);
    if (tStats) {
      tStats.submissions += 1;
    }
  });

  const mostActiveTests = Array.from(testSubmissionMap.values())
    .filter((t) => t.submissions > 0)
    .sort((a, b) => b.submissions - a.submissions)
    .slice(0, 10);

  // Violation statistics by type
  const violationsByType = new Map();
  allViolationsRaw.forEach((violation) => {
    const type = violation.type || "UNKNOWN";
    violationsByType.set(type, (violationsByType.get(type) || 0) + 1);
  });

  const violationStatistics = Array.from(violationsByType.entries()).map(([type, count]) => ({
    type,
    count,
  }));

  res.status(200).json({
    collegeComparative,
    topPerformingColleges,
    topStudents,
    mostActiveTests,
    collegeViolations,
    platformTrend,
    violationStatistics,
  });
});

module.exports = {
  getSuperAnalytics,
};
