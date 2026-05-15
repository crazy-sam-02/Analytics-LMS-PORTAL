const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");

const getColleges = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const search = (req.query.search || "").trim();

  const where = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
            { location: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const m = await models.init();
  const College = m.dbClient.college;

  const [items, total] = await Promise.all([
    College.findMany({
      where,
      include: {
        _count: {
          select: {
            departments: true,
            admins: true,
            students: true,
            tests: true,
            batches: true,
            questionBankItems: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    College.count({ where }),
  ]);

  res.status(200).json({
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});
const getCollege = asyncHandler(async (req, res) => {
  const { collegeId } = req.params;

  const m = await models.init();
  const College = m.dbClient.college;

  const college = await College.findUnique({
    where: { id: collegeId },
    include: {
      _count: {
        select: {
          departments: true,
          admins: true,
          students: true,
          tests: true,
          batches: true,
          questionBankItems: true,
        },
      },
    },
  });

  if (!college) {
    throw new ApiError(404, "College not found");
  }

  res.status(200).json(college);
});

const createCollege = asyncHandler(async (req, res) => {
  const m = await models.init();
  const College = m.dbClient.college;

  const college = await College.create({
    data: {
      name: req.body.name,
      code: req.body.code,
      location: req.body.location || null,
      isActive: true,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_COLLEGE",
    targetType: "COLLEGE",
    targetId: college.id,
    superAdminId: req.superAdmin.id,
    afterState: college,
  });

  res.status(201).json(college);
});

const updateCollege = asyncHandler(async (req, res) => {
  const { collegeId } = req.params;

  const m = await models.init();
  const College = m.dbClient.college;

  const existing = await College.findUnique({ where: { id: collegeId } });
  if (!existing) {
    throw new ApiError(404, "College not found");
  }

  if (req.body.isActive === false) {
    const expectedConfirmation = `SUSPEND ${existing.code || existing.id}`;
    if (req.body?.confirmationText !== expectedConfirmation) {
      throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
    }
  }

  const college = await College.update({
    where: { id: collegeId },
    data: {
      ...(req.body.name !== undefined ? { name: req.body.name } : {}),
      ...(req.body.code !== undefined ? { code: req.body.code } : {}),
      ...(req.body.location !== undefined ? { location: req.body.location } : {}),
      ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
      ...(req.body.isActive === false ? { deletedAt: new Date() } : {}),
      ...(req.body.isActive === true ? { deletedAt: null } : {}),
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_COLLEGE",
    targetType: "COLLEGE",
    targetId: college.id,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: college,
  });

  res.status(200).json(college);
});

const deactivateCollege = asyncHandler(async (req, res) => {
  const { collegeId } = req.params;

  const m = await models.init();
  const College = m.dbClient.college;

  const existing = await College.findUnique({ where: { id: collegeId } });
  if (!existing) {
    throw new ApiError(404, "College not found");
  }

  const college = await College.update({
    where: { id: collegeId },
    data: {
      isActive: false,
      deletedAt: new Date(),
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DEACTIVATE_COLLEGE",
    targetType: "COLLEGE",
    targetId: college.id,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: college,
  });

  res.status(200).json({ message: "College deactivated", college });
});

module.exports = {
  getColleges,
  getCollege,
  createCollege,
  updateCollege,
  deactivateCollege,
};
