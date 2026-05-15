/**
 * Report Formatter Service
 * Converts raw report data into human-readable HTML reports with charts, tables, and metrics
 */

const generateAdminReportHTML = (reportJob, reportData) => {
  const { type, generatedAt, expiresAt } = reportJob;
  const rows = reportData?.rows || [];

  if (type === "STUDENT_WISE") {
    return formatStudentWiseReport(rows, generatedAt, expiresAt);
  }

  if (type === "TEST_WISE") {
    return formatTestWiseReport(rows, generatedAt, expiresAt);
  }

  if (type === "DEPARTMENT_WISE") {
    return formatDepartmentWiseReport(rows, generatedAt, expiresAt);
  }

  if (type === "BATCH_WISE") {
    return formatBatchWiseReport(rows, generatedAt, expiresAt);
  }

  if (type === "COMPREHENSIVE") {
    return formatComprehensiveReport(rows[0] || {}, generatedAt, expiresAt);
  }

  return generateBasicHTML("Unknown Report Type", "No formatting available for this report type.");
};

const generateSuperAdminReportHTML = (reportJob, reportData) => {
  const { type, generatedAt, expiresAt } = reportJob;
  const rows = reportData?.rows || [];

  if (type === "STUDENT_WISE") {
    return formatStudentWiseReport(rows, generatedAt, expiresAt, true);
  }

  if (type === "TEST_WISE") {
    return formatTestWiseReport(rows, generatedAt, expiresAt, true);
  }

  if (type === "DEPARTMENT_WISE") {
    return formatDepartmentWiseReport(rows, generatedAt, expiresAt, true);
  }

  if (type === "BATCH_WISE") {
    return formatBatchWiseReport(rows, generatedAt, expiresAt, true);
  }

  return generateBasicHTML("Unknown Report Type", "No formatting available for this report type.");
};

// ============ Report Formatters ============

const formatStudentWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalStudents = rows.length;
  const avgScore = totalStudents > 0 ? (rows.reduce((sum, r) => sum + Number(r.score || 0), 0) / totalStudents).toFixed(2) : 0;
  const avgAccuracy = totalStudents > 0 ? (rows.reduce((sum, r) => sum + Number(r.accuracy || 0), 0) / totalStudents).toFixed(2) : 0;

  // Group by student for average scores
  const studentMap = new Map();
  rows.forEach((row) => {
    if (!studentMap.has(row.studentId)) {
      studentMap.set(row.studentId, { studentName: row.studentName, scores: [], count: 0 });
    }
    const student = studentMap.get(row.studentId);
    student.scores.push(Number(row.score || 0));
    student.count += 1;
  });

  const studentPerformance = Array.from(studentMap.values()).map((s) => ({
    name: s.studentName,
    avgScore: (s.scores.reduce((a, b) => a + b) / s.scores.length).toFixed(2),
    submissions: s.count,
  }));

  const topPerformers = studentPerformance.sort((a, b) => b.avgScore - a.avgScore).slice(0, 10);
  const scoreDistribution = calculateScoreDistribution(rows);

  return `
    ${generateHTMLHeader("Student-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${totalStudents}</div>
        <div class="metric-label">Total Submissions</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgScore}%</div>
        <div class="metric-label">Average Score</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgAccuracy}%</div>
        <div class="metric-label">Average Accuracy</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${studentMap.size}</div>
        <div class="metric-label">Unique Students</div>
      </div>
    </div>

    <div class="chart-container">
      <h2>Score Distribution</h2>
      <canvas id="scoreChart" width="400" height="150"></canvas>
      <script>
        const ctx = document.getElementById('scoreChart').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(scoreDistribution.labels)},
            datasets: [{
              label: 'Number of Students',
              data: ${JSON.stringify(scoreDistribution.counts)},
              backgroundColor: 'rgba(59, 130, 246, 0.8)',
              borderColor: 'rgba(59, 130, 246, 1)',
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      </script>
    </div>

    <div class="section">
      <h2>Top 10 Performing Students</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Student Name</th>
            <th>Average Score</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          ${topPerformers.map((p, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${p.studentName}</td>
              <td><strong>${p.avgScore}%</strong></td>
              <td>${p.submissions}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>All Submissions (${rows.length} records)</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Student ID</th>
            <th>Student Name</th>
            <th>Test Name</th>
            <th>Score</th>
            <th>Accuracy</th>
            <th>Status</th>
            <th>Submitted At</th>
          </tr>
        </thead>
        <tbody>
          ${rows.slice(0, 100).map((row) => `
            <tr>
              <td>${row.studentId || "-"}</td>
              <td>${row.studentName || "-"}</td>
              <td>${row.testName || "-"}</td>
              <td>${row.score || 0}</td>
              <td>${row.accuracy || 0}%</td>
              <td><span class="badge badge-${(row.status || "").toLowerCase()}">${row.status || "-"}</span></td>
              <td>${new Date(row.submittedAt).toLocaleDateString() || "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${rows.length > 100 ? `<p class="text-muted">Showing first 100 of ${rows.length} records</p>` : ""}
    </div>

    ${generateHTMLFooter()}
  `;
};

const formatTestWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalTests = rows.length;
  const totalParticipants = rows.reduce((sum, r) => sum + Number(r.participants || 0), 0);
  const avgScore = totalTests > 0 ? (rows.reduce((sum, r) => sum + Number(r.avgScore || 0), 0) / totalTests).toFixed(2) : 0;

  const topTests = [...rows].sort((a, b) => Number(b.avgScore || 0) - Number(a.avgScore || 0)).slice(0, 10);
  const anomaliesList = rows.filter((r) => r.anomalies && Object.keys(r.anomalies).length > 0);

  return `
    ${generateHTMLHeader("Test-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${totalTests}</div>
        <div class="metric-label">Total Tests</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${totalParticipants}</div>
        <div class="metric-label">Total Participants</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgScore}%</div>
        <div class="metric-label">Average Score</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${anomaliesList.length}</div>
        <div class="metric-label">Tests with Anomalies</div>
      </div>
    </div>

    <div class="chart-container">
      <h2>Test Performance (Top 10)</h2>
      <canvas id="testChart" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('testChart').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ${JSON.stringify(topTests.map((t) => t.testName).slice(0, 10))},
            datasets: [{
              label: 'Average Score',
              data: ${JSON.stringify(topTests.map((t) => t.avgScore).slice(0, 10))},
              backgroundColor: 'rgba(34, 197, 94, 0.8)',
              borderColor: 'rgba(34, 197, 94, 1)',
              borderWidth: 1
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, max: 100 } }
          }
        });
      </script>
    </div>

    <div class="section">
      <h2>All Tests (${rows.length} records)</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Subject</th>
            <th>Participants</th>
            <th>Average Score</th>
            <th>Average Accuracy</th>
            <th>Anomalies</th>
          </tr>
        </thead>
        <tbody>
          ${rows.slice(0, 100).map((row) => {
            const anomalyCount = row.anomalies ? Object.values(row.anomalies).flat().length : 0;
            return `
              <tr>
                <td>${row.testName || "-"}</td>
                <td>${row.subject || "-"}</td>
                <td>${row.participants || 0}</td>
                <td><strong>${row.avgScore || 0}%</strong></td>
                <td>${row.avgAccuracy || 0}%</td>
                <td>${anomalyCount > 0 ? `<span class="badge badge-warning">${anomalyCount} flagged</span>` : "None"}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>

    ${anomaliesList.length > 0 ? `
      <div class="section">
        <h2>Anomaly Summary</h2>
        <div class="alert alert-warning">
          <strong>${anomaliesList.length} test(s)</strong> have potential integrity issues requiring review.
        </div>
        ${anomaliesList.map((test) => `
          <div class="anomaly-card">
            <h3>${test.testName}</h3>
            ${test.anomalies?.unusuallyFastHighScore?.length > 0 ? `
              <p><strong>Unusually Fast High Scores:</strong> ${test.anomalies.unusuallyFastHighScore.length} cases</p>
            ` : ""}
            ${test.anomalies?.highViolationsHighScore?.length > 0 ? `
              <p><strong>High Violations + High Score:</strong> ${test.anomalies.highViolationsHighScore.length} cases</p>
            ` : ""}
            ${test.anomalies?.identicalAnswerPatternPairs?.length > 0 ? `
              <p><strong>Identical Answer Patterns:</strong> ${test.anomalies.identicalAnswerPatternPairs.length} pairs</p>
            ` : ""}
          </div>
        `).join("")}
      </div>
    ` : ""}

    ${generateHTMLFooter()}
  `;
};

const formatDepartmentWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalDepts = rows.length;
  const totalStudents = rows.reduce((sum, r) => sum + Number(r.students || 0), 0);
  const avgScore = totalDepts > 0 ? (rows.reduce((sum, r) => sum + Number(r.avgScore || 0), 0) / totalDepts).toFixed(2) : 0;

  const topDepts = [...rows].sort((a, b) => Number(b.avgScore || 0) - Number(a.avgScore || 0)).slice(0, 10);

  return `
    ${generateHTMLHeader("Department-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${totalDepts}</div>
        <div class="metric-label">Total Departments</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${totalStudents}</div>
        <div class="metric-label">Total Students</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgScore}%</div>
        <div class="metric-label">Average Score</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${(totalStudents / totalDepts).toFixed(1)}</div>
        <div class="metric-label">Students per Department</div>
      </div>
    </div>

    <div class="chart-container">
      <h2>Department Performance Comparison</h2>
      <canvas id="deptChart" width="400" height="200"></canvas>
      <script>
        const ctx = document.getElementById('deptChart').getContext('2d');
        new Chart(ctx, {
          type: 'radar',
          data: {
            labels: ${JSON.stringify(topDepts.map((d) => d.departmentName).slice(0, 8))},
            datasets: [{
              label: 'Average Score',
              data: ${JSON.stringify(topDepts.map((d) => d.avgScore).slice(0, 8))},
              borderColor: 'rgb(59, 130, 246)',
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              borderWidth: 2,
              pointRadius: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { r: { beginAtZero: true, max: 100 } }
          }
        });
      </script>
    </div>

    <div class="section">
      <h2>All Departments (${rows.length} records)</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Department Name</th>
            <th>College</th>
            <th>Students</th>
            <th>Average Score</th>
            <th>Pass Rate</th>
          </tr>
        </thead>
        <tbody>
          ${rows.slice(0, 100).map((row) => `
            <tr>
              <td>${row.departmentName || "-"}</td>
              <td>${row.collegeName || "-"}</td>
              <td>${row.students || 0}</td>
              <td><strong>${row.avgScore || 0}%</strong></td>
              <td>${row.passRate || "N/A"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${generateHTMLFooter()}
  `;
};

const formatBatchWiseReport = (rows = [], generatedAt, expiresAt, isGlobal = false) => {
  const totalBatches = rows.length;
  const totalStudents = rows.reduce((sum, r) => sum + Number(r.students || 0), 0);
  const avgScore = totalBatches > 0 ? (rows.reduce((sum, r) => sum + Number(r.avgScore || 0), 0) / totalBatches).toFixed(2) : 0;

  return `
    ${generateHTMLHeader("Batch-Wise Report" + (isGlobal ? " (Platform)" : ""), generatedAt, expiresAt)}
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${totalBatches}</div>
        <div class="metric-label">Total Batches</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${totalStudents}</div>
        <div class="metric-label">Total Students</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${avgScore}%</div>
        <div class="metric-label">Average Score</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${(totalStudents / totalBatches).toFixed(1)}</div>
        <div class="metric-label">Students per Batch</div>
      </div>
    </div>

    <div class="section">
      <h2>All Batches (${rows.length} records)</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Batch Name</th>
            <th>Department</th>
            <th>College</th>
            <th>Students</th>
            <th>Average Score</th>
          </tr>
        </thead>
        <tbody>
          ${rows.slice(0, 100).map((row) => `
            <tr>
              <td>${row.batchName || "-"}</td>
              <td>${row.departmentName || "-"}</td>
              <td>${row.collegeName || "-"}</td>
              <td>${row.students || 0}</td>
              <td><strong>${row.avgScore || 0}%</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${generateHTMLFooter()}
  `;
};

const formatComprehensiveReport = (data = {}, generatedAt, expiresAt) => {
  const summary = data.summary || {};
  const tests = data.tests || [];
  const departments = data.departments || [];
  const batches = data.batches || [];
  const recentSubmissions = data.recentSubmissions || [];

  return `
    ${generateHTMLHeader("Comprehensive Report", generatedAt, expiresAt)}
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${summary.tests || 0}</div>
        <div class="metric-label">Total Tests</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${summary.departments || 0}</div>
        <div class="metric-label">Departments</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${summary.batches || 0}</div>
        <div class="metric-label">Batches</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${summary.submissions || 0}</div>
        <div class="metric-label">Total Submissions</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${summary.averageScore || 0}%</div>
        <div class="metric-label">Overall Average Score</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${summary.averageAccuracy || 0}%</div>
        <div class="metric-label">Overall Accuracy</div>
      </div>
    </div>

    <div class="section">
      <h2>Top Tests (${Math.min(tests.length, 10)})</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Participants</th>
            <th>Average Score</th>
          </tr>
        </thead>
        <tbody>
          ${tests.slice(0, 10).map((t) => `
            <tr>
              <td>${t.testName || "-"}</td>
              <td>${t.participants || 0}</td>
              <td><strong>${t.avgScore || 0}%</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Recent Submissions (${Math.min(recentSubmissions.length, 20)})</h2>
      <table class="data-table">
        <thead>
          <tr>
            <th>Student Name</th>
            <th>Test Name</th>
            <th>Score</th>
            <th>Submitted At</th>
          </tr>
        </thead>
        <tbody>
          ${recentSubmissions.slice(0, 20).map((s) => `
            <tr>
              <td>${s.studentName || "-"}</td>
              <td>${s.testName || "-"}</td>
              <td><strong>${s.score || 0}</strong></td>
              <td>${new Date(s.submittedAt).toLocaleString() || "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${generateHTMLFooter()}
  `;
};

// ============ Helper Functions ============

const calculateScoreDistribution = (rows = []) => {
  const ranges = [
    { label: "0-20", min: 0, max: 20 },
    { label: "21-40", min: 21, max: 40 },
    { label: "41-60", min: 41, max: 60 },
    { label: "61-80", min: 61, max: 80 },
    { label: "81-100", min: 81, max: 100 },
  ];

  const counts = ranges.map((range) =>
    rows.filter((r) => {
      const score = Number(r.score || 0);
      return score >= range.min && score <= range.max;
    }).length
  );

  return {
    labels: ranges.map((r) => r.label),
    counts,
  };
};

const generateHTMLHeader = (title, generatedAt, expiresAt) => `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        line-height: 1.6;
        color: #333;
        background: #f5f5f5;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: white;
        padding: 40px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .header {
        border-bottom: 3px solid #3b82f6;
        padding-bottom: 20px;
        margin-bottom: 30px;
      }
      .header h1 {
        font-size: 2.5rem;
        color: #1f2937;
        margin-bottom: 10px;
      }
      .header-meta {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        font-size: 0.9rem;
        color: #666;
      }
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-bottom: 40px;
      }
      .metric-card {
        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
        color: white;
        padding: 25px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      }
      .metric-card:nth-child(2) {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      }
      .metric-card:nth-child(3) {
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      }
      .metric-card:nth-child(4) {
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
      }
      .metric-value {
        font-size: 2.5rem;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .metric-label {
        font-size: 0.95rem;
        opacity: 0.9;
      }
      .section {
        margin-bottom: 40px;
      }
      .section h2 {
        font-size: 1.8rem;
        color: #1f2937;
        margin-bottom: 20px;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 10px;
      }
      .chart-container {
        background: #f9fafb;
        padding: 25px;
        border-radius: 10px;
        margin-bottom: 40px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .chart-container h2 {
        margin-bottom: 20px;
      }
      .data-table {
        width: 100%;
        border-collapse: collapse;
        background: white;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .data-table thead {
        background: #f3f4f6;
        border-bottom: 2px solid #e5e7eb;
      }
      .data-table th {
        padding: 15px;
        text-align: left;
        font-weight: 600;
        color: #374151;
      }
      .data-table td {
        padding: 12px 15px;
        border-bottom: 1px solid #e5e7eb;
      }
      .data-table tbody tr:hover {
        background: #f9fafb;
      }
      .badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .badge-submitted {
        background: #d1fae5;
        color: #065f46;
      }
      .badge-auto_submitted {
        background: #bfdbfe;
        color: #1e40af;
      }
      .badge-pending {
        background: #fef3c7;
        color: #92400e;
      }
      .badge-warning {
        background: #fed7aa;
        color: #92400e;
      }
      .alert {
        padding: 15px 20px;
        border-radius: 8px;
        margin-bottom: 20px;
        border-left: 4px solid #f59e0b;
        background: #fffbeb;
        color: #92400e;
      }
      .anomaly-card {
        background: #fef3c7;
        border-left: 4px solid #f59e0b;
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 6px;
      }
      .anomaly-card h3 {
        color: #92400e;
        margin-bottom: 10px;
      }
      .anomaly-card p {
        color: #78350f;
        margin: 5px 0;
      }
      .text-muted {
        color: #999;
        font-size: 0.9rem;
        font-style: italic;
        margin-top: 10px;
      }
      .footer {
        margin-top: 50px;
        padding-top: 20px;
        border-top: 2px solid #e5e7eb;
        text-align: center;
        color: #999;
        font-size: 0.9rem;
      }
      @media print {
        body { background: white; }
        .container { box-shadow: none; }
        .data-table { page-break-inside: avoid; }
        .section { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>${title}</h1>
        <div class="header-meta">
          <div><strong>Generated:</strong> ${new Date(generatedAt).toLocaleString()}</div>
          <div><strong>Valid Until:</strong> ${new Date(expiresAt).toLocaleString()}</div>
        </div>
      </div>
`;

const generateHTMLFooter = () => `
      <div class="footer">
        <p>This report was automatically generated by the LMS Portal. For questions, contact your administrator.</p>
        <p style="margin-top: 10px; font-size: 0.85rem;">© 2026 LMS Portal. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
`;

const generateBasicHTML = (title, message) => `
  <!DOCTYPE html>
  <html>
  <head>
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 40px; }
      .container { max-width: 800px; margin: 0 auto; }
      h1 { color: #333; }
      p { color: #666; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
  </html>
`;

module.exports = {
  generateAdminReportHTML,
  generateSuperAdminReportHTML,
};
