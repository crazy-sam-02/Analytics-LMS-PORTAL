const bcrypt = require("bcrypt");
const models = require("../models");
const { ApiError } = require("../utils/http");
const { deleteAsset, uploadImageBuffer } = require("./cloudinary.service");

const getProfile = async (user) => ({ ...user });

const updateProfile = async (userId, data) => {
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { fullName: data.fullName ?? undefined, phone: data.phone ?? undefined } });
  return updated;
};

const uploadAvatar = async (userId, buffer, mimetype, previousPublicId) => {
  if (!buffer) throw new ApiError(400, "Avatar file is required", null, "AVATAR_REQUIRED");
  const uploaded = await uploadImageBuffer(buffer, { folder: "avatars", publicIdPrefix: `student-${userId}`, mimeType: mimetype });
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { avatarUrl: uploaded.url, avatarPublicId: uploaded.publicId } });
  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    try { await deleteAsset(previousPublicId); } catch {} // ignore cleanup errors
  }
  return updated;
};

const changePassword = async (userId, currentPassword, newPassword) => {
  const m = await models.init();
  const db = m.dbClient;
  const user = await db.student.findUnique({ where: { id: userId } });
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw new ApiError(400, "Current password is incorrect");
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.student.update({ where: { id: userId }, data: { passwordHash } });
  return { message: "Password updated" };
};

const updatePreferences = async (userId, preferences) => {
  const m = await models.init();
  const db = m.dbClient;
  const updated = await db.student.update({ where: { id: userId }, data: { preferences } });
  return { preferences: updated.preferences };
};

module.exports = { getProfile, updateProfile, uploadAvatar, changePassword, updatePreferences };
