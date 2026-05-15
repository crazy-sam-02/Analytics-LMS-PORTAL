const models = require("../../models");
const { asyncHandler } = require("../../utils/http");

const mapResults = (type, items) =>
  items.map((item) => ({
    id: item.id,
    type,
    title: item.title || item.name || item.fullName || item.rollNumber || item.studentId,
    subtitle:
      type === "student"
        ? item.rollNumber || item.studentId || item.email || ""
        : type === "test"
          ? item.subject || item.status || ""
          : type === "batch"
            ? item.academicYear || ""
            : item.eventDate || item.type || "",
    path:
      type === "student"
        ? "/admin/students"
        : type === "test"
          ? "/admin/tests"
          : type === "batch"
            ? "/admin/batches"
            : "/admin/events",
  }));

const adminSearch = asyncHandler(async (req, res) => {
  const m = await models.init();
  const db = m.dbClient;
  const q = String(req.query.q || "").trim();

  if (q.length < 2) {
    return res.status(200).json({ data: [] });
  }

  const whereCollege = req.collegeFilter || { collegeId: req.collegeId };

  const [tests, students, batches, events] = await Promise.all([
    db.test.findMany({
      where: {
        ...whereCollege,
        OR: [{ title: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, title: true, subject: true, status: true },
      take: 8,
      orderBy: { updatedAt: "desc" },
    }),
    db.student.findMany({
      where: {
        ...whereCollege,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { studentId: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, fullName: true, studentId: true, email: true },
      take: 8,
      orderBy: { updatedAt: "desc" },
    }),
    db.batch.findMany({
      where: {
        ...whereCollege,
        name: { contains: q, mode: "insensitive" },
      },
      select: { id: true, name: true, academicYear: true },
      take: 8,
      orderBy: { updatedAt: "desc" },
    }),
    db.event.findMany({
      where: {
        ...whereCollege,
        OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, name: true, eventDate: true, type: true },
      take: 8,
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const data = [
    ...mapResults("test", tests),
    ...mapResults("student", students),
    ...mapResults("batch", batches),
    ...mapResults("event", events),
  ];

  res.status(200).json({ data });
});

module.exports = {
  adminSearch,
};
