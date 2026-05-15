const models = require("../../models");
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

  const m = await models.init();
  const AuditLog = m.dbClient.auditLog;

  const [items, total] = await Promise.all([
    AuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    AuditLog.count({ where }),
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
