const prisma = require("../../config/db");
const { asyncHandler, ApiError } = require("../../utils/http");
const { createAuditLog } = require("../../services/audit.service");

const stringifyCsv = (headers, rows) => {
  const serialized = [headers.join(",")];
  rows.forEach((row) => {
    serialized.push(
      headers
        .map((header) => {
          const value = row[header] == null ? "" : String(row[header]);
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(",")
    );
  });
  return serialized.join("\n");
};

const createEvent = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;

  const maxParticipants = Number(req.body.maxParticipants ?? req.body.registrationLimit ?? 0);
  const startsAt = new Date(req.body.startsAt);
  const eventDate = req.body.eventDate ? new Date(req.body.eventDate) : startsAt;
  const registrationDeadline = req.body.registrationDeadline ? new Date(req.body.registrationDeadline) : null;

  if (registrationDeadline && registrationDeadline > eventDate) {
    throw new ApiError(422, "registration_deadline must be less than or equal to event_date");
  }

  if (!Number.isFinite(maxParticipants) || maxParticipants < 1) {
    throw new ApiError(422, "max_participants must be at least 1");
  }

  const event = await prisma.event.create({
    data: {
      title: req.body.title,
      description: req.body.description,
      eventType: req.body.eventType,
      startsAt,
      endsAt: req.body.endsAt ? new Date(req.body.endsAt) : null,
      eventDate,
      registrationDeadline,
      location: req.body.location || null,
      registrationLimit: maxParticipants,
      registrationUrl: req.body.registrationUrl || null,
      registrationFields: Array.isArray(req.body.registrationFields) ? req.body.registrationFields : [],
      registrants: [],
      isCancelled: false,
      collegeId,
      createdByAdminId: req.admin.id,
    },
  });

  await createAuditLog({
    action: "ADMIN_EVENT_CREATED",
    targetType: "EVENT",
    targetId: event.id,
    collegeId,
    adminId: req.admin.id,
    afterState: {
      title: event.title,
      startsAt: event.startsAt,
      registrationLimit: event.registrationLimit,
    },
  });

  await prisma.notification.create({
    data: {
      title: "Event Created",
      message: `Event \"${event.title}\" has been published.`,
      collegeId,
      adminId: req.admin.id,
    },
  });

  res.status(201).json(event);
});

const getEvents = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;

  const events = await prisma.event.findMany({
    where: { collegeId },
    orderBy: { startsAt: "asc" },
  });

  const withParticipants = events.map((event) => {
    const registrants = Array.isArray(event.registrants) ? event.registrants : [];
    return {
      ...event,
      registrantCount: registrants.length,
      spotsLeft: Math.max(Number(event.registrationLimit || 0) - registrants.length, 0),
    };
  });

  res.status(200).json(withParticipants);
});

const getEventRegistrants = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { eventId } = req.params;

  const event = await prisma.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const registrants = Array.isArray(event.registrants) ? event.registrants : [];
  const studentIds = registrants.map((item) => item.studentId).filter(Boolean);
  const students = studentIds.length
    ? await prisma.student.findMany({
        where: {
          id: { in: studentIds },
          collegeId,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          studentId: true,
          batch: { select: { name: true } },
          department: { select: { name: true } },
        },
      })
    : [];

  const studentMap = new Map(students.map((item) => [item.id, item]));
  const enriched = registrants.map((item) => ({
    ...item,
    student: studentMap.get(item.studentId) || null,
  }));

  res.status(200).json({
    eventId,
    title: event.title,
    registrants: enriched,
  });
});

const exportEventRegistrants = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { eventId } = req.params;

  const event = await prisma.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const registrants = Array.isArray(event.registrants) ? event.registrants : [];
  const headers = ["studentId", "fullName", "email", "registeredAt", "status"];
  const csv = stringifyCsv(
    headers,
    registrants.map((item) => ({
      studentId: item.studentId || "",
      fullName: item.fullName || "",
      email: item.email || "",
      registeredAt: item.registeredAt || "",
      status: item.status || "REGISTERED",
    }))
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=event-${eventId}-registrants.csv`);
  res.status(200).send(csv);
});

const cancelEvent = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;
  const { eventId } = req.params;
  const { reason } = req.body;

  const event = await prisma.event.findFirst({
    where: { id: eventId, collegeId },
  });

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      isCancelled: true,
      cancelReason: reason,
      cancelledAt: new Date(),
    },
  });

  const registrants = Array.isArray(event.registrants) ? event.registrants : [];
  if (registrants.length > 0) {
    await prisma.notification.createMany({
      data: registrants.map((item) => ({
        title: "Event Cancelled",
        message: `Event \"${event.title}\" has been cancelled. Reason: ${reason}`,
        collegeId,
        userId: item.studentId,
      })),
      skipDuplicates: true,
    });
  }

  await createAuditLog({
    action: "ADMIN_EVENT_CANCELLED",
    targetType: "EVENT",
    targetId: eventId,
    collegeId,
    adminId: req.admin.id,
    beforeState: {
      isCancelled: Boolean(event.isCancelled),
    },
    afterState: {
      isCancelled: true,
      reason,
    },
  });

  res.status(200).json({ message: "Event cancelled and students notified", event: updated });
});

module.exports = {
  createEvent,
  getEvents,
  getEventRegistrants,
  exportEventRegistrants,
  cancelEvent,
};
