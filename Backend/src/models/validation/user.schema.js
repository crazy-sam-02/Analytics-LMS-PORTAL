const mongoose = require("mongoose");
const {
  normalizeLowerEnumValue,
  referenceValidator,
  optionalReferenceValidator,
} = require("./shared");

const UserValidationSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2 },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: {
      type: String,
      required: true,
      enum: ["student", "admin", "superadmin", "STUDENT", "ADMIN", "SUPER_ADMIN"],
      set: normalizeLowerEnumValue,
    },
    password: { type: String, trim: true, minlength: 8, default: undefined },
    collegeId: { type: String, required: true, validate: referenceValidator },
    departmentId: { type: String, default: null, validate: optionalReferenceValidator },
    batchId: { type: String, default: null, validate: optionalReferenceValidator },
    year: { type: Number, required: true, min: 1, max: 4 },
    isActive: { type: Boolean, default: true },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

UserValidationSchema.pre("validate", function normalizeRole(next) {
  if (this.role) {
    this.role = normalizeLowerEnumValue(this.role);
  }

  next();
});

module.exports = mongoose.models.UserValidation || mongoose.model("UserValidation", UserValidationSchema);
