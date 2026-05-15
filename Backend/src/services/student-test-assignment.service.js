const ASSIGNMENT_METHOD = {
  EVERYONE: "everyone",
  DEPARTMENT_WISE: "department_wise",
  BATCH_WISE: "batch_wise",
};

const normalizeIds = (values = []) =>
  Array.isArray(values) ? values.filter(Boolean).map((value) => String(value)) : [];

const getStudentBatchIds = (student) =>
  [...new Set(normalizeIds([...(student?.batchIds || []), student?.batchId]))];

const buildStudentAssignmentScope = (student) => {
  const userBatchIds = getStudentBatchIds(student);
  const userDepartmentId = student?.departmentId || null;
  const hasBatches = userBatchIds.length > 0;

  const conditions = [
    {
      assignmentMethod: ASSIGNMENT_METHOD.EVERYONE,
      collegeId: student.collegeId,
    },
    ...(userDepartmentId
      ? [
          {
            assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE,
            collegeId: student.collegeId,
            departmentId: userDepartmentId,
          },
          {
            assignmentMethod: ASSIGNMENT_METHOD.DEPARTMENT_WISE,
            collegeId: student.collegeId,
            assignedTo: { in: [userDepartmentId] },
          },
          {
            assignmentMethod: null,
            collegeId: student.collegeId,
            departmentId: userDepartmentId,
          },
          {
            assignmentMethod: null,
            collegeId: student.collegeId,
            assignedTo: { in: [userDepartmentId] },
          },
        ]
      : []),
  ];

  if (hasBatches) {
    conditions.push(
      {
        assignmentMethod: ASSIGNMENT_METHOD.BATCH_WISE,
        collegeId: student.collegeId,
        batchId: { in: userBatchIds },
      },
      {
        assignmentMethod: ASSIGNMENT_METHOD.BATCH_WISE,
        collegeId: student.collegeId,
        batchAssignments: {
          some: {
            batchId: { in: userBatchIds },
          },
        },
      },
      {
        assignmentMethod: null,
        collegeId: student.collegeId,
        batchId: { in: userBatchIds },
      },
      {
        assignmentMethod: null,
        collegeId: student.collegeId,
        batchAssignments: {
          some: {
            batchId: { in: userBatchIds },
          },
        },
      }
    );
  }

  return { OR: conditions };
};

const isStudentAssignedToTest = ({ test, student, hasBatchAssignment = false }) => {
  const testCollegeId = String(test?.collegeId || "");
  const studentCollegeId = String(student?.collegeId || "");
  if (!testCollegeId || testCollegeId !== studentCollegeId) {
    return false;
  }

  const assignmentMethod = String(test?.assignmentMethod || "").trim().toLowerCase();
  const studentDepartmentId = String(student?.departmentId || "");
  const studentBatchIds = getStudentBatchIds(student);
  const assignedDepartmentIds = normalizeIds(test?.assignedTo);

  if (assignmentMethod === ASSIGNMENT_METHOD.EVERYONE) {
    return true;
  }

  if (assignmentMethod === ASSIGNMENT_METHOD.DEPARTMENT_WISE) {
    return Boolean(
      studentDepartmentId
      && (
        String(test?.departmentId || "") === studentDepartmentId
        || assignedDepartmentIds.includes(studentDepartmentId)
      )
    );
  }

  if (assignmentMethod === ASSIGNMENT_METHOD.BATCH_WISE) {
    return Boolean(
      studentBatchIds.includes(String(test?.batchId || ""))
      || hasBatchAssignment
    );
  }

  return Boolean(
    (studentDepartmentId && String(test?.departmentId || "") === studentDepartmentId)
    || (studentDepartmentId && assignedDepartmentIds.includes(studentDepartmentId))
    || studentBatchIds.includes(String(test?.batchId || ""))
    || hasBatchAssignment
  );
};

module.exports = {
  ASSIGNMENT_METHOD,
  buildStudentAssignmentScope,
  getStudentBatchIds,
  isStudentAssignedToTest,
};
