const prisma = require("../../config/db");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");

const getEventsGlobal = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      include: {
        college: true,
        createdByAdmin: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { startsAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.event.count(),
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

const createGlobalEvent = asyncHandler(async (req, res) => {
  const payload = req.body;
  const startsAt = new Date(payload.startsAt);
  const eventDate = payload.eventDate ? new Date(payload.eventDate) : startsAt;
  const registrationDeadline = payload.registrationDeadline ? new Date(payload.registrationDeadline) : null;
  const maxParticipants = Number(payload.maxParticipants ?? payload.registrationLimit ?? 1);

  let collegeIds = payload.collegeIds || [];
  if (payload.allColleges) {
    const colleges = await prisma.college.findMany({ where: { isActive: true }, select: { id: true } });
    collegeIds = colleges.map((item) => item.id);
  }

  if (!collegeIds.length) {
    throw new ApiError(400, "At least one college must be targeted");
  }

  const createdEvents = [];
  for (const collegeId of collegeIds) {
    const admin = await prisma.admin.findFirst({
      where: {
        collegeId,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!admin) {
      continue;
    }

    const event = await prisma.event.create({
      data: {
        title: payload.title,
        description: payload.description,
        eventType: payload.eventType,
        startsAt,
        endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
        eventDate,
        registrationDeadline,
        location: payload.location || null,
        registrationLimit: maxParticipants,
        registrationUrl: payload.registrationUrl || null,
        registrationFields: Array.isArray(payload.registrationFields) ? payload.registrationFields : [],
        registrants: [],
        isCancelled: false,
        isGlobal: true,
        createdByAdminId: admin.id,
        collegeId,
      },
    });

    createdEvents.push(event);
  }

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_GLOBAL_EVENT",
    targetType: "EVENT",
    targetId: createdEvents[0]?.id || "multi",
    superAdminId: req.superAdmin.id,
    afterState: {
      eventType: payload.eventType,
      colleges: collegeIds,
      createdCount: createdEvents.length,
    },
  });

  res.status(201).json({
    message: "Global event created",
    createdCount: createdEvents.length,
    data: createdEvents,
  });
});

module.exports = {
  getEventsGlobal,
  createGlobalEvent,
};
