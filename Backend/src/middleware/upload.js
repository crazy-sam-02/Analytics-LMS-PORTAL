const multer = require("multer");
const { ApiError } = require("../utils/http");

const storage = multer.memoryStorage();

const imageUpload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      return cb(new ApiError(400, "Only JPEG and PNG images are allowed", null, "INVALID_IMAGE_TYPE"));
    }

    cb(null, true);
  },
});

module.exports = {
  imageUpload,
};
