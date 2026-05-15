const { asyncHandler, ApiError } = require("../../utils/http");
const studentService = require("../../services/admin-student.service");

const getStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const opts = { page: req.query.page, limit: req.query.limit, departmentId: req.query.departmentId, batchId: req.query.batchId, search: req.query.search };
  const { data, total, page, limit } = await studentService.listStudents(collegeId, opts);
  res.status(200).json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

const createStudent = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const payload = req.body;
  const result = await studentService.createStudent(collegeId, adminId, payload);
  res.status(201).json({ student: result.student, credentials: result.credentials });
});

const getStudentPerformance = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;
  const student = await studentService.getStudentPerformance(collegeId, studentId);
  res.status(200).json(student);
});

const getStudentProfile = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const studentId = req.params.studentId;
  const student = await studentService.getStudentProfile(collegeId, studentId);
  res.status(200).json(student);
});

const assignStudentToBatch = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { studentId } = req.params;
  const { batchId } = req.body;
  const updated = await studentService.assignStudentToBatch(collegeId, adminId, studentId, batchId);
  res.status(200).json(updated);
});

const bulkImportStudents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const adminId = req.admin.id;
  const { csvData } = req.body;
  const result = await studentService.bulkImportStudents(collegeId, adminId, csvData);
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
