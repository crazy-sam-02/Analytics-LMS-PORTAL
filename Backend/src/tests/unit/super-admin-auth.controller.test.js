jest.mock("../../models", () => ({
  init: jest.fn(),
}));

jest.mock("../../utils/token", () => ({
  createAccessToken: jest.fn(() => "new-super-access-token"),
  createRefreshToken: jest.fn(() => "rotated-super-refresh-token"),
  verifyRefreshToken: jest.fn(),
}));

jest.mock("../../services/refresh-token-cache.service", () => ({
  cacheRefreshToken: jest.fn(async () => {}),
  getCachedRefreshToken: jest.fn(async () => null),
  hashRefreshToken: jest.fn((token) => `hash:${token}`),
  invalidateRefreshToken: jest.fn(async () => {}),
  invalidateRefreshTokenRecord: jest.fn(async () => {}),
}));

jest.mock("../../services/access-token-revocation.service", () => ({
  revokeAccessTokenFromRequest: jest.fn(async () => {}),
}));

const models = require("../../models");
const { verifyRefreshToken } = require("../../utils/token");
const { superAdminRefresh, superAdminLogout } = require("../../controllers/SuperAdmin/auth.controller");

const invoke = async (handler, req = {}) =>
  new Promise((resolve, reject) => {
    const res = {
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn((payload) => {
        resolve({ res, payload });
      }),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    handler(req, res, (error) => {
      if (error) {
        reject(error);
      }
    });
  });

describe("super-admin auth refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rotates refresh tokens and writes cookies for both super-admin route aliases", async () => {
    const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
    models.init.mockResolvedValue({
      dbClient: {
        superAdminRefreshToken: {
          findFirst: jest.fn().mockResolvedValue({
            id: "session-1",
            tokenHash: "hash:old-super-refresh-token",
            superAdminId: "super-1",
            revokedAt: null,
            expiresAt: nowPlusOneHour,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({
            id: "session-2",
            tokenHash: "hash:rotated-super-refresh-token",
            superAdminId: "super-1",
            revokedAt: null,
            expiresAt: nowPlusOneHour,
          }),
          update: jest.fn().mockResolvedValue({ id: "session-1" }),
        },
        superAdmin: {
          findUnique: jest.fn().mockResolvedValue({
            id: "super-1",
            role: "SUPER_ADMIN",
            isActive: true,
          }),
        },
      },
    });

    verifyRefreshToken.mockImplementation((token) => ({
      sub: "super-1",
      role: "SUPER_ADMIN",
      exp: Math.floor(Date.now() / 1000) + (token === "rotated-super-refresh-token" ? 7200 : 3600),
    }));

    const { res, payload } = await invoke(superAdminRefresh, {
      cookies: {},
      body: { refreshToken: "old-super-refresh-token" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload).toEqual({
      accessToken: "new-super-access-token",
      refreshToken: "rotated-super-refresh-token",
      sessionId: "session-2",
    });
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      "rotated-super-refresh-token",
      expect.objectContaining({ path: "/api/super-admin/auth" })
    );
    expect(res.cookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      "rotated-super-refresh-token",
      expect.objectContaining({ path: "/api/superadmin/auth" })
    );
  });

  it("clears cookies for both super-admin route aliases on logout", async () => {
    models.init.mockResolvedValue({
      dbClient: {
        superAdminRefreshToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    });

    const { res } = await invoke(superAdminLogout, {
      cookies: {},
      body: { refreshToken: "old-super-refresh-token" },
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.clearCookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      expect.objectContaining({ path: "/api/super-admin/auth" })
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      "lms_super_admin_refresh_token",
      expect.objectContaining({ path: "/api/superadmin/auth" })
    );
  });
});
