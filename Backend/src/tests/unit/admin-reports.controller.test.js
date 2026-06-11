const models = require("../../models");

jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../services/report-pdf.service", () => ({
  renderHtmlToPdfBuffer: jest.fn(),
}));

const { getReportAnalytics } = require("../../controllers/Admin/reports.controller");

const invoke = async (handler, req) => {
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      resolveResponse({ statusCode: this.statusCode, payload });
      return this;
    },
  };

  handler(req, res, (error) => {
    if (error) {
      rejectResponse(error);
    }
  });

  return responsePromise;
};

describe("admin reports controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads department analytics without a year filter", async () => {
    const db = {
      test: {
        findMany: jest.fn(async () => [{ id: "test-1", title: "Aptitude", totalMarks: 10 }]),
      },
      student: {
        findMany: jest.fn(async () => []),
      },
      submission: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
      department: {
        findMany: jest.fn(async () => []),
      },
      batch: {
        findMany: jest.fn(async () => []),
      },
    };
    models.init.mockResolvedValue({ dbClient: db });

    const response = await invoke(getReportAnalytics, {
      query: {
        mode: "department",
        studentScope: "current",
      },
      collegeId: "college-1",
      admin: {
        id: "admin-1",
        role: "ADMIN",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload.mode).toBe("department");
    expect(db.student.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ year: expect.anything() }),
    }));
  });
});
