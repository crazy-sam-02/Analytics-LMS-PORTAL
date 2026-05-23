const { asyncHandler, ApiError } = require("../../utils/http");
const models = require("../../models");
const studentService = require("../../services/admin-student.service");

const assertAdminDepartment = (req) => {
  const departmentId = req.admin?.departmentId || null;
  if (!departmentId) {
    throw new ApiError(403, "Admin is not linked to a department", null, "ADMIN_DEPARTMENT_REQUIRED");
  }
  return departmentId;
};

const assertSameDepartment = (actualDepartmentId, expectedDepartmentId, message = "Cross-department access denied") => {
  if (actualDepartmentId && expectedDepartmentId && String(actualDepartmentId) !== String(expectedDepartmentId)) {
    throw new ApiError(403, message, null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }
};

const getStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const opts = { page: req.query.page, limit: req.query.limit, departmentId: req.query.departmentId, batchId: req.query.batchId, search: req.query.search, year: req.query.year };
  const { data, total, page, limit } = await studentService.listStudents(collegeId, opts);
  res.status(200).json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

const createStudent = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const adminDepartmentId = assertAdminDepartment(req);
  const payload = req.body;
  const m = await models.init();
  const db = m.dbClient;
  const department = await db.department.findFirst({
    where: {
      collegeId,
      id: adminDepartmentId,
      name: { equals: payload.department, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (!department) {
    throw new ApiError(403, "Admins can create students only in their own department", null, "CROSS_DEPARTMENT_ACCESS_DENIED");
  }

  const result = await studentService.createStudent(collegeId, adminId, payload);
  res.status(201).json({ student: result.student, credentials: result.credentials });
});

const getStudentPerformance = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;
  const adminDepartmentId = assertAdminDepartment(req);
  const student = await studentService.getStudentPerformance(collegeId, studentId);
  if (!student) {
    throw new ApiError(404, "Student not found");
  }
  assertSameDepartment(student?.departmentId, adminDepartmentId);
  res.status(200).json(student);
});

const getStudentProfile = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;
  const adminDepartmentId = assertAdminDepartment(req);
  const student = await studentService.getStudentProfile(collegeId, studentId);
  assertSameDepartment(student?.departmentId, adminDepartmentId);
  res.status(200).json(student);
});

const assignStudentToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const adminDepartmentId = assertAdminDepartment(req);
  const { studentId } = req.params;
  const { batchId } = req.body;
  const m = await models.init();
  const db = m.dbClient;
  const [student, batch] = await Promise.all([
    db.student.findFirst({ where: { id: studentId, collegeId }, select: { id: true, departmentId: true } }),
    db.batch.findFirst({ where: { id: batchId, collegeId }, select: { id: true, departmentId: true } }),
  ]);

  if (!student || !batch) {
    throw new ApiError(404, "Student or batch not found");
  }

  assertSameDepartment(student.departmentId, adminDepartmentId, "Student is outside the admin department scope");
  assertSameDepartment(batch.departmentId, adminDepartmentId, "Batch is outside the admin department scope");

  const updated = await studentService.assignStudentToBatch(collegeId, adminId, studentId, batchId);
  res.status(200).json(updated);
});

const bulkImportStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const adminDepartmentId = assertAdminDepartment(req);
  const { csvData } = req.body;
  const result = await studentService.bulkImportStudents(collegeId, adminId, csvData, adminDepartmentId);
  res.status(202).json({ jobId: result.jobId, status: result.status, message: "Bulk import queued" });
});

const getStudentImportJob = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { jobId } = req.params;
  const job = await studentService.getStudentImportJob(collegeId, jobId);
  res.status(200).json(job);
});

module.exports = {
  getStudents,
  createStudent,
  getStudentPerformance,
  getStudentProfile,
  assignStudentToBatch,
  bulkImportStudents,
  getStudentImportJob,
};
