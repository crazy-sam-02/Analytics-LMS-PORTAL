const bcrypt = require("bcrypt");
const prisma = require("../../config/db");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");

const parseCsv = (csvText) => {
  const rows = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) return [];

  const headers = rows[0].split(",").map((value) => value.trim().toLowerCase());
  return rows.slice(1).map((line, rowIndex) => {
    const values = line.split(",").map((value) => value.trim());
    const record = { __row: rowIndex + 2 };
    headers.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
};

const normalizeColumnKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getRowValue = (row, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(row || {})) {
    if (aliasSet.has(normalizeColumnKey(key))) {
      return String(value || "").trim();
    }
  }
  return "";
};

const getAdmins = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  const search = (req.query.search || "").trim();
  const collegeId = req.query.collegeId;

  const where = {
    ...(collegeId ? { collegeId } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { employeeId: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.admin.findMany({
      where,
      include: {
        college: true,
        department: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.admin.count({ where }),
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

const createAdmin = asyncHandler(async (req, res) => {
  const { fullName, email, employeeId, password, collegeId, departmentId } = req.body;

  const college = await prisma.college.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Admin cannot be created for inactive or missing college");
  }

  const existing = await prisma.admin.findFirst({
    where: {
      OR: [
        { email, collegeId },
        { employeeId, collegeId },
      ],
    },
  });

  if (existing) {
    throw new ApiError(409, "Admin with this email or employeeId already exists in college");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.admin.create({
    data: {
      fullName,
      email,
      employeeId,
      passwordHash,
      role: "ADMIN",
      collegeId,
      departmentId: departmentId || null,
      isActive: true,
    },
    include: {
      college: true,
      department: true,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_CREATE_ADMIN",
    targetType: "ADMIN",
    targetId: admin.id,
    collegeId: admin.collegeId,
    superAdminId: req.superAdmin.id,
    afterState: {
      id: admin.id,
      email: admin.email,
      employeeId: admin.employeeId,
      isActive: admin.isActive,
    },
  });

  res.status(201).json(admin);
});

const updateAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const existing = await prisma.admin.findUnique({ where: { id: adminId } });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const data = {
    ...(req.body.fullName !== undefined ? { fullName: req.body.fullName } : {}),
    ...(req.body.collegeId !== undefined ? { collegeId: req.body.collegeId } : {}),
    ...(req.body.departmentId !== undefined ? { departmentId: req.body.departmentId } : {}),
    ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
  };

  const updated = await prisma.admin.update({
    where: { id: adminId },
    data,
    include: {
      college: true,
      department: true,
    },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_UPDATE_ADMIN",
    targetType: "ADMIN",
    targetId: updated.id,
    collegeId: updated.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: existing,
    afterState: updated,
  });

  res.status(200).json(updated);
});

const resetAdminPassword = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const existing = await prisma.admin.findUnique({ where: { id: adminId } });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await prisma.admin.update({
    where: { id: adminId },
    data: { passwordHash },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_RESET_ADMIN_PASSWORD",
    targetType: "ADMIN",
    targetId: adminId,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
  });

  res.status(200).json({ message: "Admin password reset" });
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;

  const existing = await prisma.admin.findUnique({
    where: { id: adminId },
    include: {
      _count: { select: { createdTests: true } },
    },
  });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const expectedConfirmation = `DEACTIVATE ${existing.employeeId || existing.id}`;
  if (req.body?.confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  await prisma.admin.update({
    where: { id: adminId },
    data: { isActive: false },
  });

  await createAuditLog({
    action: "SUPER_ADMIN_DEACTIVATE_ADMIN",
    targetType: "ADMIN",
    targetId: adminId,
    collegeId: existing.collegeId,
    superAdminId: req.superAdmin.id,
    beforeState: {
      isActive: existing.isActive,
      createdTests: existing._count.createdTests,
    },
    afterState: { isActive: false },
  });

  res.status(200).json({
    message: "Admin deactivated",
    note: existing._count.createdTests > 0 ? "Reassign admin's tests if needed" : null,
  });
});

const bulkImportAdmins = asyncHandler(async (req, res) => {
  const { csvData, defaultCollegeId } = req.body;
  const rows = parseCsv(csvData);

  if (!rows.length) {
    throw new ApiError(400, "No admin rows found in import file");
  }

  const colleges = await prisma.college.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
  });

  const byId = new Map(colleges.map((college) => [String(college.id), college]));
  const byCode = new Map(colleges.map((college) => [String(college.code || "").toLowerCase(), college]));
  const byName = new Map(colleges.map((college) => [String(college.name || "").toLowerCase(), college]));

  const fallbackCollege = defaultCollegeId ? byId.get(String(defaultCollegeId)) : null;
  if (defaultCollegeId && !fallbackCollege) {
    throw new ApiError(400, "Default college is missing or inactive");
  }

  const result = {
    created: 0,
    failed: 0,
    duplicates: 0,
    errors: [],
  };

  for (const row of rows) {
    const fullName = getRowValue(row, ["fullName", "full_name", "name", "adminName", "admin_name"]);
    const email = getRowValue(row, ["email", "emailAddress"]);
    const employeeId = getRowValue(row, ["employeeId", "employee_id", "staffId", "staff_id"]);
    const passwordInput = getRowValue(row, ["password"]);
    const collegeIdInput = getRowValue(row, ["collegeId", "college_id"]);
    const collegeCodeInput = getRowValue(row, ["collegeCode", "college_code", "code"]);
    const collegeNameInput = getRowValue(row, ["collegeName", "college_name", "college"]);
    const departmentInput = getRowValue(row, ["department", "departmentName", "department_name", "departmentId", "department_id"]);

    if (!fullName || !email || !employeeId) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Missing required columns: fullName, email, employeeId" });
      continue;
    }

    const resolvedCollege =
      (collegeIdInput ? byId.get(String(collegeIdInput)) : null)
      || (collegeCodeInput ? byCode.get(String(collegeCodeInput).toLowerCase()) : null)
      || (collegeNameInput ? byName.get(String(collegeNameInput).toLowerCase()) : null)
      || fallbackCollege
      || null;

    if (!resolvedCollege) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Unable to resolve college (collegeId/collegeCode/collegeName/defaultCollegeId)" });
      continue;
    }

    const duplicate = await prisma.admin.findFirst({
      where: {
        collegeId: resolvedCollege.id,
        OR: [
          { email },
          { employeeId },
        ],
      },
      select: { id: true },
    });

    if (duplicate) {
      result.duplicates += 1;
      result.errors.push({ row: row.__row, reason: "Duplicate admin email or employeeId for selected college" });
      continue;
    }

    let resolvedDepartment = null;
    if (departmentInput) {
      const byDepartmentId = await prisma.department.findFirst({
        where: {
          id: departmentInput,
          collegeId: resolvedCollege.id,
        },
        select: { id: true },
      });

      resolvedDepartment = byDepartmentId || await prisma.department.findFirst({
        where: {
          collegeId: resolvedCollege.id,
          name: {
            equals: departmentInput,
            mode: "insensitive",
          },
        },
        select: { id: true },
      });

      if (!resolvedDepartment) {
        result.failed += 1;
        result.errors.push({ row: row.__row, reason: "Department not found for selected college" });
        continue;
      }
    }

    const plainPassword = passwordInput || "Admin@12345";
    if (plainPassword.length < 8) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Password must be at least 8 characters" });
      continue;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await prisma.admin.create({
      data: {
        fullName,
        email,
        employeeId,
        passwordHash,
        role: "ADMIN",
        collegeId: resolvedCollege.id,
        departmentId: resolvedDepartment?.id || null,
        isActive: true,
      },
    });

    result.created += 1;
  }

  await createAuditLog({
    action: "SUPER_ADMIN_BULK_IMPORT_ADMINS",
    targetType: "ADMIN_IMPORT",
    targetId: `ADMIN_IMPORT_${Date.now()}`,
    superAdminId: req.superAdmin.id,
    afterState: {
      defaultCollegeId: fallbackCollege?.id || null,
      summary: result,
    },
  });

  res.status(200).json({
    message: "Admin bulk import processed",
    result,
  });
});

module.exports = {
  getAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deleteAdmin,
  bulkImportAdmins,
};
