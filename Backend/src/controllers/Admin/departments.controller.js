const prisma = require("../../config/db");
const { asyncHandler } = require("../../utils/http");

const getDepartments = asyncHandler(async (req, res) => {
  const collegeId = req.collegeId;

  const departments = await prisma.department.findMany({
    where: { collegeId },
    include: {
      _count: {
        select: {
          batches: true,
          students: true,
          tests: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  res.status(200).json(departments);
});

module.exports = {
  getDepartments,
};
