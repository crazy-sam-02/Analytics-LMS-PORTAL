const mongoose = require("mongoose");
const {
  normalizeUpperEnumValue,
  referenceValidator,
  optionalReferenceValidator,
} = require("./shared");

const QUESTION_TYPES = [
  "MCQ",
  "MCQ_MULTI",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "BOOLEAN",
  "FILL_BLANK",
  "PARAGRAPH",
];

const QuestionValidationSchema = new mongoose.Schema(
  {
    testId: { type: String, required: true, validate: referenceValidator },
    collegeId: { type: String, required: true, validate: referenceValidator },
    prompt: { type: String, required: true, trim: true, minlength: 1 },
    type: {
      type: String,
      required: true,
      enum: QUESTION_TYPES,
      set: normalizeUpperEnumValue,
    },
    options: { type: [mongoose.Schema.Types.Mixed], default: [] },
    correctOption: { type: String, default: null, trim: true },
    correctBoolean: { type: Boolean, default: null },
    correctText: { type: String, default: null, trim: true },
    marks: { type: Number, required: true, min: 0 },
    order: { type: Number, required: true, min: 0 },
    explanation: { type: String, default: null, trim: true },
    sourceQuestionId: { type: String, default: null, validate: optionalReferenceValidator },
    isActive: { type: Boolean, default: true },
  },
  {
    _id: false,
    minimize: false,
    strict: false,
  }
);

QuestionValidationSchema.pre("validate", function normalizeQuestionType(next) {
  if (this.type) {
    this.type = normalizeUpperEnumValue(this.type);
  }

  next();
});

module.exports = mongoose.models.QuestionValidation || mongoose.model("QuestionValidation", QuestionValidationSchema);