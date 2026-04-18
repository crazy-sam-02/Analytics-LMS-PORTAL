const bcrypt = require("bcrypt");
const prisma = require("../../config/db");
const { ApiError, asyncHandler } = require("../../utils/http");
const { deleteAsset, uploadImageBuffer } = require("../../services/cloudinary.service");

const getProfile = asyncHandler(async (req, res) => {
  res.status(200).json(req.user);
});

const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, phone } = req.body;

  const updated = await prisma.student.update({
    where: { id: req.user.id },
    data: {
      fullName: fullName ?? req.user.fullName,
      phone: phone ?? req.user.phone,
    },
  });

  res.status(200).json(updated);
});

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new ApiError(400, "Avatar file is required", null, "AVATAR_REQUIRED");
  }

  const uploaded = await uploadImageBuffer(req.file.buffer, {
    folder: "avatars",
    publicIdPrefix: `student-${req.user.id}`,
    mimeType: req.file.mimetype,
  });

  const previousPublicId = req.user.avatarPublicId || null;

  const updated = await prisma.student.update({
    where: { id: req.user.id },
    data: {
      avatarUrl: uploaded.url,
      avatarPublicId: uploaded.publicId,
    },
  });

  if (previousPublicId && previousPublicId !== uploaded.publicId) {
    try {
      await deleteAsset(previousPublicId);
    } catch {
      // Ignore cleanup errors to avoid failing successful uploads.
    }
  }

  res.status(200).json({
    avatarUrl: updated.avatarUrl,
    avatar_url: updated.avatarUrl,
    avatarPublicId: updated.avatarPublicId,
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await prisma.student.findUnique({ where: { id: req.user.id } });
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!matches) {
    throw new ApiError(400, "Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.student.update({
    where: { id: req.user.id },
    data: { passwordHash },
  });

  res.status(200).json({ message: "Password updated" });
});

const updatePreferences = asyncHandler(async (req, res) => {
  const { preferences } = req.body;

  const updated = await prisma.student.update({
    where: { id: req.user.id },
    data: { preferences },
  });

  res.status(200).json({ preferences: updated.preferences });
});

module.exports = {
  getProfile,
  updateProfile,
  uploadAvatar,
  changePassword,
  updatePreferences,
};
