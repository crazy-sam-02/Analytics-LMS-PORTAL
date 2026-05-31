const { ApiError } = require("../utils/http");

const notFound = (_req, _res, next) => {
  next(new ApiError(404, "Route not found", null, "ROUTE_NOT_FOUND"));
};

const getRequestId = (req) => req.id || req.headers["x-request-id"] || null;

const errorHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    return _next(error);
  }

  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, "body")) {
    return res.status(400).json({
      message: "Invalid JSON payload",
      code: "INVALID_JSON_PAYLOAD",
      requestId: getRequestId(_req),
      details: null,
    });
  }

  if (error?.name === "MulterError") {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 400 : 422;
    return res.status(statusCode).json({
      message: error.code === "LIMIT_FILE_SIZE" ? "File size exceeds the configured upload limit" : "Invalid file upload",
      code: error.code || "UPLOAD_ERROR",
      requestId: getRequestId(_req),
      details: null,
    });
  }

  const dbUnavailable =
    error?.name === "MongoNetworkError" ||
    error?.name === "MongoServerSelectionError" ||
    ["P1001", "P1002", "P1008", "ECONNREFUSED", "ETIMEDOUT"].includes(String(error?.code || "").toUpperCase());

  const statusCode = dbUnavailable ? 503 : (error.statusCode || 500);
  const message = error.message || "Internal server error";
  const code = dbUnavailable
    ? "SERVICE_UNAVAILABLE"
    : (error.code || (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED"));
  const requestId = getRequestId(_req);

  if (statusCode >= 500) {
    console.error(`[api-error] request_id=${requestId || "-"} ${_req.method} ${_req.originalUrl}`, error);
  }

  res.status(statusCode).json({
    message: dbUnavailable ? "Service temporarily unavailable. Please retry shortly." : message,
    code,
    requestId,
    details: error.details || null,
  });
};

module.exports = {
  notFound,
  errorHandler,
};
