const prisma = require("../../config/db");
const { ApiError, asyncHandler } = require("../../utils/http");

const DEFAULT_SUBJECTS = [
  "Quantitative Aptitude",
  "Verbal Ability",
  "Logical Reasoning",
  "Non-Verbal Reasoning",
  "Coding",
  "General Aptitude",
];

const ensureDefaultSubjects = async (collegeId) => {
  const existing = await prisma.subject.findMany({
    where: { collegeId },
    select: { id: true },
    take: 1,
  });

  if (existing.length > 0) {
    return;
  }

  await prisma.subject.createMany({
    data: DEFAULT_SUBJECTS.map((name) => ({
      name,
      collegeId,
    })),
    skipDuplicates: true,
  });
};

const getSubjects = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  await ensureDefaultSubjects(collegeId);

  const subjects = await prisma.subject.findMany({
    where: { collegeId },
    orderBy: { updatedAt: "desc" },
  });

  const subjectIds = subjects.map((item) => item.id);
  const counts = subjectIds.length
    ? await Promise.all(
        subjectIds.map((subjectId) =>
          prisma.questionBank.count({
            where: { collegeId, subjectId, isActive: { not: false } },
          })
        )
      )
    : [];

  res.status(200).json(
    subjects.map((subject, index) => ({
      ...subject,
      questionCount: counts[index] || 0,
      lastUpdated: subject.updatedAt || subject.createdAt,
    }))
  );
});

const createSubject = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const name = String(req.body?.name || "").trim();

  if (!name) {
    throw new ApiError(422, "Subject name is required");
  }

  const exists = await prisma.subject.findFirst({
    where: {
      collegeId,
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (exists) {
    throw new ApiError(409, "Subject already exists");
  }

  const subject = await prisma.subject.create({
    data: {
      collegeId,
      name,
      createdByAdminId: req.admin.id,
    },
  });

  res.status(201).json(subject);
});

const deleteSubject = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { id } = req.params;

  const subject = await prisma.subject.findFirst({
    where: { id, collegeId },
  });

  if (!subject) {
    throw new ApiError(404, "Subject not found");
  }

  const linkedQuestions = await prisma.questionBank.count({
    where: { collegeId, subjectId: id },
  });

  if (linkedQuestions > 0) {
    throw new ApiError(409, "Cannot delete subject with existing questions", { questionCount: linkedQuestions }, "SUBJECT_IN_USE");
  }

  await prisma.subject.delete({ where: { id } });

  res.status(200).json({ message: "Subject deleted" });
});

module.exports = {
  getSubjects,
  createSubject,
  deleteSubject,
};