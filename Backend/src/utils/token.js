const jwt = require("jsonwebtoken");
const env = require("../config/env");

const createAccessToken = (principal) => {
  const role = principal.role || "STUDENT";

  return jwt.sign(
    {
      sub: principal.id,
      role,
      collegeId: principal.collegeId,
      college_id: principal.collegeId,
      email: principal.email,
      fullName: principal.fullName,
      studentId: principal.studentId,
      employeeId: principal.employeeId,
      permissions: Array.isArray(principal.permissions) ? principal.permissions : undefined,
    },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn }
  );
};

const createRefreshToken = (principal) => {
  return jwt.sign(
    {
      sub: principal.id,
      role: principal.role || "STUDENT",
      type: "refresh",
    },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn }
  );
};

const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret);
const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

module.exports = {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
