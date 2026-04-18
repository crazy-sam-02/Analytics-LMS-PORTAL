const bcrypt = require("bcrypt");
const prisma = require("../../src/config/db");

async function seed() {
  const college = await prisma.college.upsert({
    where: { name: "Evergreen Institute of Technology" },
    update: {
      code: "EGT",
      location: "Bengaluru",
      isActive: true,
    },
    create: {
      name: "Evergreen Institute of Technology",
      code: "EGT",
      location: "Bengaluru",
      isActive: true,
    },
  });

  const otherCollege = await prisma.college.upsert({
    where: { name: "North Valley College" },
    update: {
      code: "NVC",
      location: "Pune",
      isActive: true,
    },
    create: {
      name: "North Valley College",
      code: "NVC",
      location: "Pune",
      isActive: true,
    },
  });

  const [csDepartment, eeDepartment] = await Promise.all([
    prisma.department.upsert({
      where: { name_collegeId: { name: "Computer Science", collegeId: college.id } },
      update: {},
      create: {
        name: "Computer Science",
        collegeId: college.id,
      },
    }),
    prisma.department.upsert({
      where: { name_collegeId: { name: "Electrical Engineering", collegeId: college.id } },
      update: {},
      create: {
        name: "Electrical Engineering",
        collegeId: college.id,
      },
    }),
  ]);

  const [nvCsDepartment, nvMeDepartment] = await Promise.all([
    prisma.department.upsert({
      where: { name_collegeId: { name: "Computer Science", collegeId: otherCollege.id } },
      update: {},
      create: {
        name: "Computer Science",
        collegeId: otherCollege.id,
      },
    }),
    prisma.department.upsert({
      where: { name_collegeId: { name: "Mechanical Engineering", collegeId: otherCollege.id } },
      update: {},
      create: {
        name: "Mechanical Engineering",
        collegeId: otherCollege.id,
      },
    }),
  ]);

  const [csBatchA, csBatchB, eeBatchA] = await Promise.all([
    prisma.batch.upsert({
      where: {
        name_year_departmentId: {
          name: "CSE-2026-A",
          year: 2026,
          departmentId: csDepartment.id,
        },
      },
      update: {},
      create: {
        name: "CSE-2026-A",
        year: 2026,
        departmentId: csDepartment.id,
        collegeId: college.id,
      },
    }),
    prisma.batch.upsert({
      where: {
        name_year_departmentId: {
          name: "CSE-2026-B",
          year: 2026,
          departmentId: csDepartment.id,
        },
      },
      update: {},
      create: {
        name: "CSE-2026-B",
        year: 2026,
        departmentId: csDepartment.id,
        collegeId: college.id,
      },
    }),
    prisma.batch.upsert({
      where: {
        name_year_departmentId: {
          name: "EEE-2026-A",
          year: 2026,
          departmentId: eeDepartment.id,
        },
      },
      update: {},
      create: {
        name: "EEE-2026-A",
        year: 2026,
        departmentId: eeDepartment.id,
        collegeId: college.id,
      },
    }),
  ]);

  const [nvCsBatchA, nvMeBatchA] = await Promise.all([
    prisma.batch.upsert({
      where: {
        name_year_departmentId: {
          name: "NVC-CSE-2026-A",
          year: 2026,
          departmentId: nvCsDepartment.id,
        },
      },
      update: {},
      create: {
        name: "NVC-CSE-2026-A",
        year: 2026,
        departmentId: nvCsDepartment.id,
        collegeId: otherCollege.id,
      },
    }),
    prisma.batch.upsert({
      where: {
        name_year_departmentId: {
          name: "NVC-ME-2026-A",
          year: 2026,
          departmentId: nvMeDepartment.id,
        },
      },
      update: {},
      create: {
        name: "NVC-ME-2026-A",
        year: 2026,
        departmentId: nvMeDepartment.id,
        collegeId: otherCollege.id,
      },
    }),
  ]);

  const passwordHash = await bcrypt.hash("Password@123", 10);
  const adminPasswordHash = await bcrypt.hash("Admin@12345", 10);
  const superAdminPasswordHash = await bcrypt.hash("SuperAdmin@123", 10);

  await prisma.superAdmin.upsert({
    where: { email: "superadmin@lms.com" },
    update: {
      fullName: "Platform Super Admin",
      passwordHash: superAdminPasswordHash,
      isActive: true,
      role: "SUPER_ADMIN",
    },
    create: {
      email: "superadmin@lms.com",
      fullName: "Platform Super Admin",
      passwordHash: superAdminPasswordHash,
      isActive: true,
      role: "SUPER_ADMIN",
    },
  });

  const admin = await prisma.admin.upsert({
    where: {
      email_collegeId: {
        email: "admin@evergreen.edu",
        collegeId: college.id,
      },
    },
    update: {
      fullName: "Nikita Rao",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      departmentId: csDepartment.id,
      isActive: true,
    },
    create: {
      employeeId: "ADM-001",
      email: "admin@evergreen.edu",
      fullName: "Nikita Rao",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      collegeId: college.id,
      departmentId: csDepartment.id,
    },
  });

  await prisma.admin.upsert({
    where: {
      email_collegeId: {
        email: "admin@northvalley.edu",
        collegeId: otherCollege.id,
      },
    },
    update: {
      fullName: "Shreya Nair",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      isActive: true,
    },
    create: {
      employeeId: "ADM-NV-1",
      email: "admin@northvalley.edu",
      fullName: "Shreya Nair",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      collegeId: otherCollege.id,
    },
  });

  const student = await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student1@evergreen.edu",
        collegeId: college.id,
      },
    },
    update: {
      fullName: "Aarav Sharma",
      studentId: "STU-882910",
      passwordHash,
      batchId: csBatchA.id,
      departmentId: csDepartment.id,
      isActive: true,
      role: "STUDENT",
      preferences: {
        examMode: "focus",
        receiveEventReminders: true,
      },
    },
    create: {
      studentId: "STU-882910",
      email: "student1@evergreen.edu",
      fullName: "Aarav Sharma",
      passwordHash,
      batchId: csBatchA.id,
      departmentId: csDepartment.id,
      collegeId: college.id,
      preferences: {
        examMode: "focus",
        receiveEventReminders: true,
      },
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student2@evergreen.edu",
        collegeId: college.id,
      },
    },
    update: {
      fullName: "Ishita Patel",
      studentId: "STU-882911",
      passwordHash,
      batchId: csBatchB.id,
      departmentId: csDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-882911",
      email: "student2@evergreen.edu",
      fullName: "Ishita Patel",
      passwordHash,
      batchId: csBatchB.id,
      departmentId: csDepartment.id,
      collegeId: college.id,
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student4@evergreen.edu",
        collegeId: college.id,
      },
    },
    update: {
      fullName: "Neha Kulkarni",
      studentId: "STU-882913",
      passwordHash,
      batchId: csBatchA.id,
      departmentId: csDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-882913",
      email: "student4@evergreen.edu",
      fullName: "Neha Kulkarni",
      passwordHash,
      batchId: csBatchA.id,
      departmentId: csDepartment.id,
      collegeId: college.id,
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student5@evergreen.edu",
        collegeId: college.id,
      },
    },
    update: {
      fullName: "Karan Malhotra",
      studentId: "STU-882914",
      passwordHash,
      batchId: csBatchB.id,
      departmentId: csDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-882914",
      email: "student5@evergreen.edu",
      fullName: "Karan Malhotra",
      passwordHash,
      batchId: csBatchB.id,
      departmentId: csDepartment.id,
      collegeId: college.id,
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student1@northvalley.edu",
        collegeId: otherCollege.id,
      },
    },
    update: {
      fullName: "Riya Deshmukh",
      studentId: "STU-NV-1001",
      passwordHash,
      batchId: nvCsBatchA.id,
      departmentId: nvCsDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-NV-1001",
      email: "student1@northvalley.edu",
      fullName: "Riya Deshmukh",
      passwordHash,
      batchId: nvCsBatchA.id,
      departmentId: nvCsDepartment.id,
      collegeId: otherCollege.id,
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student2@northvalley.edu",
        collegeId: otherCollege.id,
      },
    },
    update: {
      fullName: "Omkar Joshi",
      studentId: "STU-NV-1002",
      passwordHash,
      batchId: nvCsBatchA.id,
      departmentId: nvCsDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-NV-1002",
      email: "student2@northvalley.edu",
      fullName: "Omkar Joshi",
      passwordHash,
      batchId: nvCsBatchA.id,
      departmentId: nvCsDepartment.id,
      collegeId: otherCollege.id,
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student3@northvalley.edu",
        collegeId: otherCollege.id,
      },
    },
    update: {
      fullName: "Manasi Patil",
      studentId: "STU-NV-1003",
      passwordHash,
      batchId: nvMeBatchA.id,
      departmentId: nvMeDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-NV-1003",
      email: "student3@northvalley.edu",
      fullName: "Manasi Patil",
      passwordHash,
      batchId: nvMeBatchA.id,
      departmentId: nvMeDepartment.id,
      collegeId: otherCollege.id,
    },
  });

  await prisma.student.upsert({
    where: {
      email_collegeId: {
        email: "student3@evergreen.edu",
        collegeId: college.id,
      },
    },
    update: {
      fullName: "Rahul Verma",
      studentId: "STU-882912",
      passwordHash,
      batchId: eeBatchA.id,
      departmentId: eeDepartment.id,
      isActive: true,
      role: "STUDENT",
    },
    create: {
      studentId: "STU-882912",
      email: "student3@evergreen.edu",
      fullName: "Rahul Verma",
      passwordHash,
      batchId: eeBatchA.id,
      departmentId: eeDepartment.id,
      collegeId: college.id,
    },
  });

  const now = new Date();
  const ongoingStart = new Date(now.getTime() - 30 * 60 * 1000);
  const ongoingEnd = new Date(now.getTime() + 60 * 60 * 1000);
  const upcomingStart = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const upcomingEnd = new Date(upcomingStart.getTime() + 90 * 60 * 1000);

  const ongoingTest = await prisma.test.upsert({
    where: { id: "test-ongoing-data-structures" },
    update: {},
    create: {
      id: "test-ongoing-data-structures",
      title: "Data Structures Midterm",
      subject: "Data Structures",
      description: "Arrays, linked lists, stacks, queues and complexity analysis.",
      durationMins: 90,
      totalMarks: 30,
      attemptsAllowed: 2,
      evaluationRule: "BEST_ATTEMPT",
      startsAt: ongoingStart,
      endsAt: ongoingEnd,
      isPublished: true,
      status: "PUBLISHED",
      batchId: csBatchA.id,
      collegeId: college.id,
      createdByAdminId: admin.id,
      departmentId: csDepartment.id,
      restrictTabSwitch: true,
      restrictCopyPaste: true,
      restrictRightClick: true,
      requireFullscreen: true,
      violationLimit: 3,
    },
  });

  await prisma.testBatch.createMany({
    data: [
      {
        testId: ongoingTest.id,
        batchId: csBatchA.id,
        collegeId: college.id,
      },
      {
        testId: ongoingTest.id,
        batchId: csBatchB.id,
        collegeId: college.id,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.test.upsert({
    where: { id: "test-upcoming-dbms" },
    update: {},
    create: {
      id: "test-upcoming-dbms",
      title: "DBMS Assessment",
      subject: "Database Management Systems",
      description: "Normalization, transactions, SQL optimization.",
      durationMins: 90,
      totalMarks: 40,
      attemptsAllowed: 1,
      evaluationRule: "LAST_ATTEMPT",
      startsAt: upcomingStart,
      endsAt: upcomingEnd,
      isPublished: true,
      status: "UPCOMING",
      batchId: csBatchA.id,
      collegeId: college.id,
      createdByAdminId: admin.id,
      departmentId: csDepartment.id,
      restrictTabSwitch: true,
      restrictCopyPaste: true,
      restrictRightClick: true,
      requireFullscreen: true,
      violationLimit: 3,
    },
  });

  const questions = [
    {
      prompt: "What is the average-case time complexity of binary search?",
      type: "MCQ",
      options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
      correctOption: "O(log n)",
      order: 1,
    },
    {
      prompt: "A stack follows FIFO order.",
      type: "TRUE_FALSE",
      options: ["True", "False"],
      correctBoolean: false,
      order: 2,
    },
    {
      prompt: "Fill in the blank: A queue follows ________ order.",
      type: "FILL_BLANK",
      options: [],
      correctText: "FIFO",
      order: 3,
    },
  ];

  for (const q of questions) {
    await prisma.question.upsert({
      where: { testId_order: { testId: ongoingTest.id, order: q.order } },
      update: {},
      create: {
        testId: ongoingTest.id,
        collegeId: college.id,
        prompt: q.prompt,
        type: q.type,
        options: q.options,
        correctOption: q.correctOption || null,
        correctBoolean: q.correctBoolean ?? null,
        correctText: q.correctText || null,
        order: q.order,
      },
    });
  }

  await prisma.event.createMany({
    data: [
      {
        title: "AI Hackathon Sprint",
        description: "24-hour challenge focused on practical AI prototypes.",
        eventType: "Hackathon",
        startsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000),
        location: "Innovation Lab",
        registrationLimit: 150,
        registrationUrl: "https://example.com/register/hackathon",
        collegeId: college.id,
        createdByAdminId: admin.id,
      },
      {
        title: "Cloud Systems Workshop",
        description: "Hands-on deployment workshop with Kubernetes basics.",
        eventType: "Workshop",
        startsAt: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        location: "Seminar Hall B",
        registrationLimit: 60,
        registrationUrl: "https://example.com/register/workshop",
        collegeId: college.id,
        createdByAdminId: admin.id,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.questionBank.createMany({
    data: [
      {
        collegeId: college.id,
        subject: "Data Structures",
        difficulty: "MEDIUM",
        prompt: "Which data structure uses LIFO?",
        type: "MCQ",
        options: ["Queue", "Stack", "Tree", "Graph"],
        correctOption: "Stack",
        marks: 1,
        createdByAdminId: admin.id,
      },
      {
        collegeId: college.id,
        subject: "Aptitude",
        difficulty: "EASY",
        prompt: "2 + 2 = 4",
        type: "TRUE_FALSE",
        options: ["True", "False"],
        correctBoolean: true,
        marks: 1,
        createdByAdminId: admin.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log("Seed complete");
  console.log("Demo student login => student1@evergreen.edu / Password@123");
  console.log("Demo student login => student1@northvalley.edu / Password@123");
  console.log("Demo admin login => admin@evergreen.edu / Admin@12345");
  console.log("Demo admin login => admin@northvalley.edu / Admin@12345");
  console.log("Demo super admin login => superadmin@lms.com / SuperAdmin@123");
  console.log(`Student: ${student.fullName}`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
