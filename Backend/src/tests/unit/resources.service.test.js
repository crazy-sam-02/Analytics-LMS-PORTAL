const path = require("path");

process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/lms_test";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "a".repeat(48);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "b".repeat(48);

const {
  assertSafeStoredPath,
  buildVisibilityWhereForActor,
  canAccessResource,
  normalizeResourcePayload,
} = require("../../modules/resources/services/resource.service");

describe("learning resources service", () => {
  it("grants students access only through matching college visibility scopes", () => {
    const student = {
      id: "student-1",
      role: "STUDENT",
      collegeId: "college-1",
      departmentId: "dept-1",
      batchIds: ["batch-1"],
    };

    expect(canAccessResource(student, {
      collegeId: "college-1",
      visibilityScope: "COLLEGE",
      isActive: true,
    })).toBe(true);

    expect(canAccessResource(student, {
      collegeId: "college-1",
      visibilityScope: "DEPARTMENT",
      departmentIds: ["dept-2"],
      isActive: true,
    })).toBe(false);

    expect(canAccessResource(student, {
      collegeId: "college-1",
      visibilityScope: "BATCH",
      batchIds: ["batch-1"],
      isActive: true,
    })).toBe(true);
  });

  it("builds department-admin queries with college and department isolation", () => {
    const where = buildVisibilityWhereForActor({
      id: "admin-1",
      role: "ADMIN",
      collegeId: "college-1",
      departmentId: "dept-1",
      batchIds: [],
    });

    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { isActive: { not: false } },
        {
          OR: expect.arrayContaining([
            { collegeId: "college-1", departmentIds: { in: ["dept-1"] } },
            { collegeId: "college-1", uploadedBy: "admin-1" },
          ]),
        },
      ]),
    });
  });

  it("normalizes comma-separated upload fields", () => {
    const payload = normalizeResourcePayload({
      title: "Placement Guide",
      subjectId: "subject-1",
      resourceType: "google drive url",
      visibilityScope: "batch",
      batchIds: "batch-1, batch-2",
      tags: "aptitude, placement",
    });

    expect(payload).toMatchObject({
      resourceType: "GOOGLE_DRIVE_URL",
      visibilityScope: "BATCH",
      batchIds: ["batch-1", "batch-2"],
      tags: ["aptitude", "placement"],
    });
  });

  it("rejects stored file paths outside the upload root", () => {
    const outside = path.resolve(process.cwd(), "..", "secret.pdf");

    expect(() => assertSafeStoredPath(outside)).toThrow(expect.objectContaining({
      code: "UNSAFE_RESOURCE_PATH",
    }));
  });
});
