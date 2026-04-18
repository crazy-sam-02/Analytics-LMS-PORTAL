const prisma = require("../../config/db");
const { asyncHandler } = require("../../utils/http");

const getAuditLogs = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const action = req.query.action;
  const targetType = req.query.targetType;

  const where = {
    ...(action ? { action } : {}),
    ...(targetType ? { targetType } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        admin: {
          select: { id: true, fullName: true, email: true },
        },
        superAdmin: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
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

module.exports = {
  getAuditLogs,
};
