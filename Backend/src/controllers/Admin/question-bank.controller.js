const prisma = require("../../config/db");
const { ApiError, asyncHandler } = require("../../utils/http");

const mapQuestionType = (type) => {
  const map = {
    mcq: "MCQ",
    true_false: "TRUE_FALSE",
    fill_blank: "FILL_BLANK",
    paragraph: "PARAGRAPH",
  };
  return map[type];
};

const addQuestionBankItem = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;

  if (!req.body.subjectId && !req.body.subject) {
    throw new ApiError(422, "subjectId or subject is required");
  }

  let subjectId = req.body.subjectId || null;
  if (!subjectId) {
    const existingSubject = await prisma.subject.findFirst({
      where: {
        collegeId,
        name: { equals: String(req.body.subject || "").trim(), mode: "insensitive" },
      },
    });

    if (existingSubject) {
      subjectId = existingSubject.id;
    } else {
      const createdSubject = await prisma.subject.create({
        data: {
          name: String(req.body.subject || "").trim(),
          collegeId,
          createdByAdminId: req.admin.id,
        },
      });
      subjectId = createdSubject.id;
    }
  }

  const item = await prisma.questionBank.create({
    data: {
      collegeId,
      subjectId,
      subject: req.body.subject || null,
      difficulty: req.body.difficulty,
      prompt: req.body.question,
      type: mapQuestionType(req.body.type),
      options: req.body.options || [],
      correctOption: req.body.type === "mcq" ? String(req.body.correctAnswer) : null,
      correctBoolean: req.body.type === "true_false" ? Boolean(req.body.correctAnswer) : null,
      correctText: req.body.type === "fill_blank" || req.body.type === "paragraph" ? String(req.body.correctAnswer) : null,
      marks: req.body.marks,
      tags: Array.isArray(req.body.tags) ? req.body.tags : [],
      usageCount: 0,
      isActive: true,
      createdByAdminId: req.admin.id,
    },
  });

  res.status(201).json(item);
});

const getQuestionBank = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);

  const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : null;
  const toDate = req.query.toDate ? new Date(req.query.toDate) : null;

  const where = {
    collegeId,
    ...(req.query.subjectId ? { subjectId: req.query.subjectId } : {}),
    ...(req.query.subject ? { subject: req.query.subject } : {}),
    ...(req.query.difficulty ? { difficulty: req.query.difficulty } : {}),
    ...(req.query.type ? { type: mapQuestionType(req.query.type) } : {}),
    ...(req.query.search
      ? {
          prompt: {
            contains: req.query.search,
            mode: "insensitive",
          },
        }
      : {}),
    ...(fromDate || toDate
      ? {
          createdAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.questionBank.count({ where }),
    prisma.questionBank.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.status(200).json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const exportQuestionBankJson = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;

  const items = await prisma.questionBank.findMany({
    where: { collegeId },
    orderBy: { createdAt: "desc" },
  });

  const payload = items.map((item) => ({
    type: String(item.type).toLowerCase(),
    question: item.prompt,
    options: item.options,
    correctAnswer: item.correctOption || item.correctText || item.correctBoolean,
    marks: item.marks,
    difficulty: item.difficulty,
    subject: item.subject,
  }));

  res.status(200).json(payload);
});

const importQuestionBankJson = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const items = req.body.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, "items[] is required");
  }

  const data = items.map((item) => {
    if (!item.question || String(item.question).trim() === "") {
      throw new ApiError(422, "No empty questions allowed");
    }

    if (item.type === "mcq" && !Array.isArray(item.options)) {
      throw new ApiError(422, "MCQ options are required");
    }

    if (item.correctAnswer === undefined || item.correctAnswer === null || item.correctAnswer === "") {
      throw new ApiError(422, "correctAnswer is required");
    }

    return {
      collegeId,
      subjectId: item.subjectId || null,
      subject: item.subject || "General",
      difficulty: item.difficulty || "MEDIUM",
      prompt: item.question,
      type: mapQuestionType(item.type),
      options: item.options || [],
      correctOption: item.type === "mcq" ? String(item.correctAnswer) : null,
      correctBoolean: item.type === "true_false" ? Boolean(item.correctAnswer) : null,
      correctText: item.type === "fill_blank" || item.type === "paragraph" ? String(item.correctAnswer) : null,
      marks: item.marks || 1,
      tags: Array.isArray(item.tags) ? item.tags : [],
      usageCount: 0,
      isActive: item.isActive !== false,
      createdByAdminId: req.admin.id,
    };
  });

  await prisma.$transaction([
    prisma.questionBank.createMany({
      data,
      skipDuplicates: true,
    }),
  ]);

  res.status(201).json({ message: "Question bank import complete", count: data.length });
});

const updateQuestionBankItem = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { id } = req.params;

  const existing = await prisma.questionBank.findFirst({
    where: { id, collegeId },
  });

  if (!existing) {
    throw new ApiError(404, "Question not found");
  }

  const type = req.body.type || String(existing.type || "").toLowerCase();

  const updated = await prisma.questionBank.update({
    where: { id },
    data: {
      subjectId: req.body.subjectId || existing.subjectId || null,
      subject: req.body.subject || existing.subject || null,
      difficulty: req.body.difficulty || existing.difficulty,
      type: req.body.type ? mapQuestionType(req.body.type) : existing.type,
      prompt: req.body.question || existing.prompt,
      options: Array.isArray(req.body.options) ? req.body.options : existing.options,
      correctOption:
        type === "mcq"
          ? String(req.body.correctAnswer ?? existing.correctOption ?? "")
          : null,
      correctBoolean:
        type === "true_false"
          ? Boolean(req.body.correctAnswer ?? existing.correctBoolean)
          : null,
      correctText:
        type === "fill_blank" || type === "paragraph"
          ? String(req.body.correctAnswer ?? existing.correctText ?? "")
          : null,
      marks: req.body.marks || existing.marks,
      tags: Array.isArray(req.body.tags) ? req.body.tags : existing.tags || [],
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : existing.isActive,
    },
  });

  res.status(200).json(updated);
});

const deleteQuestionBankItem = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { id } = req.params;

  const existing = await prisma.questionBank.findFirst({
    where: { id, collegeId },
  });

  if (!existing) {
    throw new ApiError(404, "Question not found");
  }

  if (Number(existing.usageCount || 0) > 0) {
    throw new ApiError(409, "Question already used in tests and cannot be deleted", null, "QUESTION_IN_USE");
  }

  await prisma.questionBank.delete({ where: { id } });

  res.status(200).json({ message: "Question deleted" });
});

module.exports = {
  addQuestionBankItem,
  getQuestionBank,
  exportQuestionBankJson,
  importQuestionBankJson,
  updateQuestionBankItem,
  deleteQuestionBankItem,
};
