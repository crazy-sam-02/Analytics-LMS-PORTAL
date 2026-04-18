const prisma = require("../../config/db");
const { asyncHandler, ApiError } = require("../../utils/http");

const getEvents = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const skip = (page - 1) * limit;
  const eventType = String(req.query.eventType || "").trim();

  const where = {
    collegeId: req.user.collegeId,
    ...(eventType
      ? {
          eventType: {
            equals: eventType,
            mode: "insensitive",
          },
        }
      : {}),
  };

  const [total, events] = await Promise.all([
    prisma.event.count({
      where,
    }),
    prisma.event.findMany({
      where,
      orderBy: { startsAt: "asc" },
      skip,
      take: limit,
    }),
  ]);

  res.status(200).json({
    data: events.map((event) => {
      const registrants = Array.isArray(event.registrants) ? event.registrants : [];
      const isRegistered = registrants.some((item) => item.studentId === req.user.id);
      const availableSpots = Math.max(Number(event.registrationLimit || 0) - registrants.length, 0);
      return {
        ...event,
        isRegistered,
        availableSpots,
      };
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const registerEvent = asyncHandler(async (req, res) => {
  const { eventId } = req.params;

  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      collegeId: req.user.collegeId,
    },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (event.isCancelled) {
    throw new ApiError(409, "Event cancelled", { eventId }, "EVENT_CANCELLED");
  }

  const now = new Date();
  if (event.registrationDeadline && new Date(event.registrationDeadline) < now) {
    throw new ApiError(409, "Registration closed", { eventId }, "EVENT_REGISTRATION_CLOSED");
  }

  const registrants = Array.isArray(event.registrants) ? event.registrants : [];
  if (registrants.some((item) => item.studentId === req.user.id)) {
    throw new ApiError(409, "Already registered", { eventId }, "ALREADY_REGISTERED");
  }

  const limit = Number(event.registrationLimit || 0);
  if (limit > 0 && registrants.length >= limit) {
    throw new ApiError(409, "Event full", { eventId }, "EVENT_FULL");
  }

  const nextRegistrant = {
    studentId: req.user.id,
    fullName: req.user.fullName,
    email: req.user.email,
    registeredAt: now.toISOString(),
    status: "REGISTERED",
  };

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      registrants: [...registrants, nextRegistrant],
    },
  });

  res.status(200).json({
    message: "Registered successfully",
    eventId,
    registrantCount: Array.isArray(updated.registrants) ? updated.registrants.length : registrants.length + 1,
  });
});

module.exports = { getEvents, registerEvent };
