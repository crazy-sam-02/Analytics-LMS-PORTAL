import reducer, { openTestEditDialog } from "./testCreationSlice";

describe("testCreationSlice edit hydration", () => {
  it("hydrates super-admin department-wise scope from assignedTo", () => {
    const state = reducer(
      undefined,
      openTestEditDialog({
        test: {
          id: "test-1",
          title: "Physics",
          assignmentMethod: "department_wise",
          collegeId: "college-1",
          assignedTo: ["dept-1", "dept-2"],
          batchAssignments: [],
        },
      })
    );

    expect(state.form.departmentIds).toEqual(["dept-1", "dept-2"]);
    expect(state.form.collegeIds).toEqual(["college-1"]);
  });
});
