const prisma = require("../../config/db");
const { asyncHandler, ApiError } = require("../../utils/http");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
};

const getNotifications = asyncHandler(async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(100, parsePositiveInt(req.query.limit, 20));
  const skip = (page - 1) * limit;
  const unread = String(req.query.unread || "").toLowerCase() === "true";

  const where = {
    collegeId: req.user.collegeId,
    OR: [{ userId: req.user.id }, { userId: null }],
    ...(unread ? { isRead: false } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  res.status(200).json({
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      collegeId: req.user.collegeId,
      OR: [{ userId: req.user.id }, { userId: null }],
    },
  });

  if (!notification) {
    throw new ApiError(404, "Notification not found");
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });

  res.status(200).json(updated);
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: {
      collegeId: req.user.collegeId,
      userId: req.user.id,
      isRead: false,
    },
    data: { isRead: true },
  });

  res.status(200).json({ message: "All notifications marked as read" });
});

module.exports = {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};