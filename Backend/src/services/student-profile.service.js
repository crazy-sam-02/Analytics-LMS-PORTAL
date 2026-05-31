const bcrypt = require("bcrypt");
const models = require("../models");
const { ApiError } = require("../utils/http");
const { deleteAsset, uploadImageBuffer } = require("./cloudinary.service");
const { invalidateRefreshTokenRecord } = require("./refresh-token-cache.service");
const { bumpPrincipalTokenVersion, invalidatePrincipalAuthCache } = require("./auth-revocation.service");

const getProfile = async (user) => ({ ...user });

const updateProfile = async (userId, data) => {
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { fullName: data.fullName ?? undefined, phone: data.phone ?? undefined } });
  await invalidatePrincipalAuthCache("student", userId);
  return updated;
};

const uploadAvatar = async (userId, buffer, mimetype, previousPublicId) => {
  if (!buffer) throw new ApiError(400, "Avatar file is required", null, "AVATAR_REQUIRED");
  const uploaded = await uploadImageBuffer(buffer, { folder: "avatars", publicIdPrefix: `student-${userId}`, mimeType: mimetype });
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { avatarUrl: uploaded.url, avatarPublicId: uploaded.publicId } });
  await invalidatePrincipalAuthCache("student", userId);
  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    try { await deleteAsset(previousPublicId); } catch {} // ignore cleanup errors
  }
  return updated;
};

const revokeStudentRefreshTokens = async (db, userId) => {
  const activeTokens = await db.studentRefreshToken.findMany({
    where: { userId, revokedAt: null },
  });

  await db.studentRefreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await Promise.all(activeTokens.map((record) => invalidateRefreshTokenRecord("student", record)));
};

const changePassword = async (userId, currentPassword, newPassword) => {
  const m = await models.init();
  const db = m.dbClient;
  const user = await db.student.findUnique({ where: { id: userId } });
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required", null, "PASSWORDS_REQUIRED");
  }
  if (!user?.passwordHash) {
    throw new ApiError(400, "Student password is not set", null, "PASSWORD_NOT_SET");
  }
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw new ApiError(400, "Current password is incorrect");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.student.update({ where: { id: userId }, data: { passwordHash } });
  await bumpPrincipalTokenVersion(db, "student", userId);
  await revokeStudentRefreshTokens(db, userId);
  return { message: "Password updated" };
};

const updatePreferences = async (userId, preferences) => {
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { preferences } });
  await invalidatePrincipalAuthCache("student", userId);
  return { preferences: updated.preferences };
};

module.exports = { getProfile, updateProfile, uploadAvatar, changePassword, updatePreferences };
