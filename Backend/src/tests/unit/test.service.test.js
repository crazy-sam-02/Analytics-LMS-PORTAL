const models = require("../../models");
const {
  calculateSubmissionScore,
  findAnswerForQuestion,
  isAnswerProvided,
  isQuestionCorrect,
} = require("../../services/test.service");

describe("test service scoring", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not count cleared blank answers as completed", async () => {
    jest.spyOn(models, "init").mockResolvedValue({
      dbClient: {
        submission: {
          findUnique: jest.fn(async () => ({
            id: "submission-1",
            test: {
              questions: [
                { id: "q1", type: "MCQ", correctOption: "A", marks: 5 },
                { id: "q2", type: "FILL_BLANK", correctText: "React", marks: 5 },
              ],
            },
            answers: [
              { questionId: "q1", selectedOption: null, selectedOptions: [], answerText: "", answerBoolean: null },
              { questionId: "q2", answerText: "React" },
            ],
          })),
        },
      },
    });

    const summary = await calculateSubmissionScore("submission-1");

    expect(summary).toEqual({
      score: 5,
      accuracy: 50,
      completion: 50,
      totalQuestions: 2,
    });
  });

  it("scores multi-select answers by comparing option sets", () => {
    const question = {
      type: "MCQ_MULTI",
      correctOptions: ["A", "C"],
    };

    expect(isQuestionCorrect(question, { selectedOptions: ["C", "A"] })).toBe(true);
    expect(isQuestionCorrect(question, { selectedOptions: ["A"] })).toBe(false);
  });

  it("uses the same answered check as the student test palette", () => {
    expect(isAnswerProvided({ selectedOption: null, selectedOptions: [], answerText: "" })).toBe(false);
    expect(isAnswerProvided({ markedForReview: true })).toBe(false);
    expect(isAnswerProvided({ selectedOption: 0 })).toBe(true);
    expect(isAnswerProvided({ answerBoolean: false })).toBe(true);
    expect(isAnswerProvided({ selectedOptions: ["A"] })).toBe(true);
  });

  it("scores numeric zero as a real selected option", () => {
    const question = {
      type: "MCQ",
      correctOption: "0",
    };

    expect(isQuestionCorrect(question, { selectedOption: 0 })).toBe(true);
  });

  it("matches answers through included question source ids", () => {
    const answer = {
      questionId: "question-copy-1",
      question: {
        id: "question-copy-1",
        sourceQuestionId: "bank-question-1",
      },
    };

    expect(findAnswerForQuestion([answer], { id: "bank-question-1" })).toBe(answer);
  });
});
