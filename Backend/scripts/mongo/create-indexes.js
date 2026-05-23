require("dotenv").config();
const mongoose = require("mongoose");

const env = require("../../src/config/env");

const createIndexes = async () => {
  if (!env.mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName || undefined,
  });

  const database = mongoose.connection.db;
  const indexes = [
    ["testBatch", { batchId: 1, testId: 1 }],
    ["testBatch", { testId: 1, batchId: 1 }],
    ["test", { collegeId: 1, status: 1 }],
    ["test", { collegeId: 1, assignmentMethod: 1, departmentId: 1 }],
    ["test", { collegeId: 1, batchId: 1 }],
    ["submission", { collegeId: 1, testId: 1, status: 1 }],
    ["submission", { collegeId: 1, userId: 1, submittedAt: -1 }],
  ];

  for (const [collectionName, spec] of indexes) {
    await database.collection(collectionName).createIndex(spec, { background: true });
    console.log(`Ensured ${collectionName} index ${JSON.stringify(spec)}`);
  }
};

createIndexes()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
