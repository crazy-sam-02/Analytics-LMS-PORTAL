const { ApiError } = require("../utils/http");

const notFound = (_req, _res, next) => {
  next(new ApiError(404, "Route not found", null, "ROUTE_NOT_FOUND"));
};

const errorHandler = (error, _req, res, _next) => {
  if (error?.name === "MulterError") {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 400 : 422;
    return res.status(statusCode).json({
      message: error.code === "LIMIT_FILE_SIZE" ? "Image size exceeds 2MB limit" : "Invalid file upload",
      code: error.code || "UPLOAD_ERROR",
      requestId: _req.headers["x-request-id"] || null,
      details: null,
    });
  }

  const statusCode = error.statusCode || 500;
  const message = error.message || "Internal server error";
  const code = error.code || (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");
  const requestId = _req.headers["x-request-id"] || null;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    message,
    code,
    requestId,
    details: error.details || null,
  });
};

module.exports = {
  notFound,
  errorHandler,
};
