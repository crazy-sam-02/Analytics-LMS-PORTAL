const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const models = require("../../models");
const { createAuditLog } = require("../../services/audit.service");
const { ApiError, asyncHandler } = require("../../utils/http");
const { ADMIN_ACCESS_PROFILES, resolvePermissionsFromProfile } = require("../../constants/admin-access-profiles");

const resolveAdminById = async (Admin, adminId) => {
  const byId = await Admin.findUnique({ where: { id: adminId } });
  if (byId) return byId;
  const byStringObjectId = await Admin.findFirst({ where: { _id: adminId } });
  if (byStringObjectId) return byStringObjectId;
  if (mongoose.isValidObjectId(adminId)) {
    return Admin.findFirst({ where: { _id: new mongoose.Types.ObjectId(adminId) } });
  }
  return null;
};

const resolveAdminUpdateWhere = (adminId, existing) => {
  if (existing?.id) {
    return { id: existing.id };
  }
  if (mongoose.isValidObjectId(adminId)) {
    return { _id: new mongoose.Types.ObjectId(adminId) };
  }
  return { _id: adminId };
};

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
  const status = String(req.query.status || "").trim().toLowerCase();

  const statusFilter =
    status === "active"
      ? { isActive: true }
      : status === "inactive"
        ? { isActive: false }
        : {};

  const where = {
    ...statusFilter,
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
    (async () => {
      const m = await models.init();
      return m.dbClient.admin.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
    })(),
    (async () => {
      const m = await models.init();
      return m.dbClient.admin.count({ where });
    })(),
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
  const { fullName, email, employeeId, password, collegeId, departmentId, accessProfile = ADMIN_ACCESS_PROFILES.EDITOR } = req.body;

  const m = await models.init();
  const College = m.dbClient.college;
  const Admin = m.dbClient.admin;
  const Department = m.dbClient.department;

  const college = await College.findUnique({ where: { id: collegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Admin cannot be created for inactive or missing college");
  }

  if (!departmentId) {
    throw new ApiError(422, "Department is required for admin", null, "MISSING_DEPARTMENT_ID");
  }

  const department = await Department.findFirst({
    where: { id: departmentId, collegeId },
  });
  if (!department) {
    throw new ApiError(400, "Department not found for selected college");
  }

  const existing = await Admin.findFirst({
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

  const admin = await Admin.create({
    data: {
      fullName,
      email,
      employeeId,
      passwordHash,
      role: "ADMIN",
      collegeId,
      departmentId,
      accessProfile,
      permissions: resolvePermissionsFromProfile(accessProfile),
      isActive: true,
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
      accessProfile: admin.accessProfile,
      isActive: admin.isActive,
    },
  });

  res.status(201).json(admin);
});

const updateAdmin = asyncHandler(async (req, res) => {
  const { adminId } = req.params;
  const m = await models.init();
  const Admin = m.dbClient.admin;
  const College = m.dbClient.college;
  const Department = m.dbClient.department;
  const existing = await resolveAdminById(Admin, adminId);

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const nextCollegeId = req.body.collegeId ?? existing.collegeId;
  const nextDepartmentId = req.body.departmentId ?? existing.departmentId;

  if (!nextCollegeId || !nextDepartmentId) {
    throw new ApiError(422, "Admin must belong to a college and department", null, "ADMIN_SCOPE_REQUIRED");
  }

  if (req.body.collegeId && !req.body.departmentId) {
    throw new ApiError(422, "Department is required when changing college", null, "MISSING_DEPARTMENT_ID");
  }

  const college = await College.findUnique({ where: { id: nextCollegeId } });
  if (!college || !college.isActive) {
    throw new ApiError(400, "Admin cannot be assigned to inactive or missing college");
  }

  const department = await Department.findFirst({
    where: { id: nextDepartmentId, collegeId: nextCollegeId },
  });
  if (!department) {
    throw new ApiError(400, "Department not found for selected college");
  }

  const data = {
    ...(req.body.fullName !== undefined ? { fullName: req.body.fullName } : {}),
    ...(req.body.collegeId !== undefined ? { collegeId: req.body.collegeId } : {}),
    ...(req.body.departmentId !== undefined ? { departmentId: req.body.departmentId } : {}),
    ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
    ...(req.body.accessProfile !== undefined
      ? {
          accessProfile: req.body.accessProfile,
          permissions: resolvePermissionsFromProfile(req.body.accessProfile),
        }
      : {}),
  };

  const updated = await Admin.update({
    where: resolveAdminUpdateWhere(adminId, existing),
    data,
  });

  if (!updated) {
    throw new ApiError(404, "Admin not found");
  }

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
  const m = await models.init();
  const Admin = m.dbClient.admin;
  const existing = await resolveAdminById(Admin, adminId);

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const passwordHash = await bcrypt.hash(req.body.password, 10);
  await Admin.update({
    where: resolveAdminUpdateWhere(adminId, existing),
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

  const m = await models.init();
  const Admin = m.dbClient.admin;

  const existing = await resolveAdminById(Admin, adminId);
  const existingWithCount = await Admin.findUnique({
    where: resolveAdminUpdateWhere(adminId, existing),
    include: { _count: { select: { createdTests: true } } },
  });

  if (!existing) {
    throw new ApiError(404, "Admin not found");
  }

  const expectedConfirmation = `DEACTIVATE ${existing.employeeId || existing.id}`;
  if (req.body?.confirmationText !== expectedConfirmation) {
    throw new ApiError(400, `Typed acknowledgment mismatch. Expected: ${expectedConfirmation}`);
  }

  await Admin.update({
    where: resolveAdminUpdateWhere(adminId, existing),
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
      createdTests: existingWithCount?._count?.createdTests || 0,
    },
    afterState: { isActive: false },
  });

  res.status(200).json({
    message: "Admin deactivated",
    note: existingWithCount?._count?.createdTests > 0 ? "Reassign admin's tests if needed" : null,
  });
});

const bulkImportAdmins = asyncHandler(async (req, res) => {
  const { csvData, defaultCollegeId } = req.body;
  const rows = parseCsv(csvData);

  if (!rows.length) {
    throw new ApiError(400, "No admin rows found in import file");
  }

  const m = await models.init();
  const College = m.dbClient.college;
  const Admin = m.dbClient.admin;
  const Department = m.dbClient.department;

  const colleges = await College.findMany({
    where: { isActive: true },
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

    if (!departmentInput) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Missing required column: department" });
      continue;
    }

    const duplicate = await Admin.findFirst({
      where: {
        collegeId: resolvedCollege.id,
        OR: [
          { email },
          { employeeId },
        ],
      },
    });

    if (duplicate) {
      result.duplicates += 1;
      result.errors.push({ row: row.__row, reason: "Duplicate admin email or employeeId for selected college" });
      continue;
    }

    const byDepartmentId = await Department.findFirst({
      where: {
        id: departmentInput,
        collegeId: resolvedCollege.id,
      },
    });

    const resolvedDepartment = byDepartmentId || await Department.findFirst({
      where: {
        collegeId: resolvedCollege.id,
        name: {
          equals: departmentInput,
          mode: "insensitive",
        },
      },
    });

    if (!resolvedDepartment) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Department not found for selected college" });
      continue;
    }

    const plainPassword = passwordInput || "Admin@12345";
    if (plainPassword.length < 8) {
      result.failed += 1;
      result.errors.push({ row: row.__row, reason: "Password must be at least 8 characters" });
      continue;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await Admin.create({
      data: {
        fullName,
        email,
        employeeId,
        passwordHash,
        role: "ADMIN",
        collegeId: resolvedCollege.id,
        departmentId: resolvedDepartment.id,
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
