const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const env = require("./env");

const uri = env.mongoUri;
if (!uri) {
  throw new Error("MONGODB_URI is required");
}

let db;

const MODEL_TO_COLLECTION = {
  college: "college",
  superAdmin: "superAdmin",
  superAdminRefreshToken: "superAdminRefreshToken",
  department: "department",
  batch: "batch",
  admin: "admin",
  student: "student",
  test: "test",
  question: "question",
  questionBank: "questionBank",
  subject: "subject",
  submission: "submission",
  answer: "answer",
  violation: "violation",
  event: "event",
  studentRefreshToken: "studentRefreshToken",
  adminRefreshToken: "adminRefreshToken",
  testSession: "testSession",
  testBatch: "testBatch",
  reportJob: "reportJob",
  superReportJob: "superReportJob",
  platformSetting: "platformSetting",
  auditLog: "auditLog",
  notification: "notification",
};

const RELATIONS = {
  college: {
    departments: { model: "department", type: "many", sourceField: "id", targetField: "collegeId" },
    admins: { model: "admin", type: "many", sourceField: "id", targetField: "collegeId" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "collegeId" },
    reportJobs: { model: "reportJob", type: "many", sourceField: "id", targetField: "collegeId" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "collegeId" },
    notifications: { model: "notification", type: "many", sourceField: "id", targetField: "collegeId" },
    events: { model: "event", type: "many", sourceField: "id", targetField: "collegeId" },
    tests: { model: "test", type: "many", sourceField: "id", targetField: "collegeId" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "collegeId" },
    questionBankItems: { model: "questionBank", type: "many", sourceField: "id", targetField: "collegeId" },
    subjects: { model: "subject", type: "many", sourceField: "id", targetField: "collegeId" },
    batches: { model: "batch", type: "many", sourceField: "id", targetField: "collegeId" },
  },
  superAdmin: {
    refreshTokens: { model: "superAdminRefreshToken", type: "many", sourceField: "id", targetField: "superAdminId" },
    reportJobs: { model: "superReportJob", type: "many", sourceField: "id", targetField: "initiatedById" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "superAdminId" },
    settings: { model: "platformSetting", type: "many", sourceField: "id", targetField: "updatedById" },
  },
  superAdminRefreshToken: {
    superAdmin: { model: "superAdmin", type: "one", sourceField: "superAdminId", targetField: "id" },
  },
  department: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    batches: { model: "batch", type: "many", sourceField: "id", targetField: "departmentId" },
    admins: { model: "admin", type: "many", sourceField: "id", targetField: "departmentId" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "departmentId" },
    tests: { model: "test", type: "many", sourceField: "id", targetField: "departmentId" },
  },
  batch: {
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    students: { model: "student", type: "many", sourceField: "id", targetField: "batchId" },
    tests: { model: "test", type: "many", sourceField: "id", targetField: "batchId" },
    testAssignments: { model: "testBatch", type: "many", sourceField: "id", targetField: "batchId" },
  },
  admin: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    createdTests: { model: "test", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    questionBankItems: { model: "questionBank", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    createdSubjects: { model: "subject", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    events: { model: "event", type: "many", sourceField: "id", targetField: "createdByAdminId" },
    refreshTokens: { model: "adminRefreshToken", type: "many", sourceField: "id", targetField: "adminId" },
    reportJobs: { model: "reportJob", type: "many", sourceField: "id", targetField: "adminId" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "adminId" },
    notifications: { model: "notification", type: "many", sourceField: "id", targetField: "adminId" },
  },
  student: {
    batch: { model: "batch", type: "one", sourceField: "batchId", targetField: "id" },
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "userId" },
    refreshTokens: { model: "studentRefreshToken", type: "many", sourceField: "id", targetField: "userId" },
    testSessions: { model: "testSession", type: "many", sourceField: "id", targetField: "userId" },
  },
  test: {
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    batch: { model: "batch", type: "one", sourceField: "batchId", targetField: "id" },
    department: { model: "department", type: "one", sourceField: "departmentId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    batchAssignments: { model: "testBatch", type: "many", sourceField: "id", targetField: "testId" },
    questions: { model: "question", type: "many", sourceField: "id", targetField: "testId" },
    submissions: { model: "submission", type: "many", sourceField: "id", targetField: "testId" },
    testSessions: { model: "testSession", type: "many", sourceField: "id", targetField: "testId" },
    auditLogs: { model: "auditLog", type: "many", sourceField: "id", targetField: "testId" },
    notifications: { model: "notification", type: "many", sourceField: "id", targetField: "testId" },
  },
  question: {
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
    answers: { model: "answer", type: "many", sourceField: "id", targetField: "questionId" },
  },
  questionBank: {
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    subjectRef: { model: "subject", type: "one", sourceField: "subjectId", targetField: "id" },
  },
  subject: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
  },
  submission: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    answers: { model: "answer", type: "many", sourceField: "id", targetField: "submissionId" },
    violations: { model: "violation", type: "many", sourceField: "id", targetField: "submissionId" },
  },
  answer: {
    submission: { model: "submission", type: "one", sourceField: "submissionId", targetField: "id" },
    question: { model: "question", type: "one", sourceField: "questionId", targetField: "id" },
  },
  violation: {
    submission: { model: "submission", type: "one", sourceField: "submissionId", targetField: "id" },
  },
  event: {
    createdByAdmin: { model: "admin", type: "one", sourceField: "createdByAdminId", targetField: "id" },
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
  },
  studentRefreshToken: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
  },
  adminRefreshToken: {
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
  },
  testSession: {
    user: { model: "student", type: "one", sourceField: "userId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
  },
  testBatch: {
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
    batch: { model: "batch", type: "one", sourceField: "batchId", targetField: "id" },
  },
  reportJob: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
  },
  superReportJob: {
    initiatedBy: { model: "superAdmin", type: "one", sourceField: "initiatedById", targetField: "id" },
  },
  platformSetting: {
    updatedBy: { model: "superAdmin", type: "one", sourceField: "updatedById", targetField: "id" },
  },
  auditLog: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
    superAdmin: { model: "superAdmin", type: "one", sourceField: "superAdminId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
  },
  notification: {
    college: { model: "college", type: "one", sourceField: "collegeId", targetField: "id" },
    admin: { model: "admin", type: "one", sourceField: "adminId", targetField: "id" },
    test: { model: "test", type: "one", sourceField: "testId", targetField: "id" },
  },
};

const DEFAULTS = {
  college: { isActive: true },
  superAdmin: { role: "SUPER_ADMIN", isActive: true },
  department: {},
  batch: {},
  admin: { role: "ADMIN", isActive: true },
  student: { role: "STUDENT", isActive: true },
  test: {
    status: "DRAFT",
    attemptsAllowed: 1,
    evaluationRule: "BEST_ATTEMPT",
    isPublished: false,
    restrictTabSwitch: true,
    restrictCopyPaste: true,
    restrictRightClick: true,
    requireFullscreen: true,
    violationLimit: 3,
    isGlobal: false,
  },
  question: { options: [], marks: 1 },
  questionBank: { options: [], marks: 1, difficulty: "MEDIUM" },
  subject: {},
  submission: {
    attemptNumber: 1,
    score: 0,
    accuracy: 0,
    status: "IN_PROGRESS",
    startedAt: () => new Date(),
    timeSpentSeconds: 0,
    violationCount: 0,
  },
  answer: { markedForReview: false },
  event: { isGlobal: false },
  studentRefreshToken: {},
  adminRefreshToken: {},
  superAdminRefreshToken: {},
  testSession: { startedAt: () => new Date() },
  testBatch: {},
  violation: { metadata: null },
  reportJob: { status: "QUEUED" },
  superReportJob: { status: "QUEUED" },
  platformSetting: {},
  auditLog: {},
  notification: { channel: "IN_APP", isRead: false },
};

function materializeDefaults(modelName) {
  const source = DEFAULTS[modelName] || {};
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    out[k] = typeof v === "function" ? v() : v;
  }
  return out;
}

async function ensureConnected() {
  if (db) {
    return db;
  }

  await mongoose.connect(uri, {
    dbName: env.mongoDbName || undefined,
    maxPoolSize: 10,
    minPoolSize: 1,
    retryWrites: true,
  });

  db = mongoose.connection.db;
  return db;
}

function isOperatorObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.some((k) => ["in", "contains", "mode", "gt", "gte", "lt", "lte", "not", "equals"].includes(k));
}

function normalizeWhere(where) {
  if (!where || typeof where !== "object" || Array.isArray(where)) {
    return where;
  }

  const out = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      key.includes("_") &&
      !isOperatorObject(value) &&
      !["OR", "AND", "NOT"].includes(key)
    ) {
      Object.assign(out, value);
      continue;
    }
    out[key] = value;
  }

  return out;
}

function matchesScalar(value, condition) {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
      return value === condition.equals;
    }

    if (Object.prototype.hasOwnProperty.call(condition, "in")) {
      return Array.isArray(condition.in) && condition.in.includes(value);
    }

    if (Object.prototype.hasOwnProperty.call(condition, "contains")) {
      const hay = value == null ? "" : String(value);
      const needle = String(condition.contains);
      if (condition.mode === "insensitive") {
        return hay.toLowerCase().includes(needle.toLowerCase());
      }
      return hay.includes(needle);
    }

    if (Object.prototype.hasOwnProperty.call(condition, "gt") && !(value > condition.gt)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(condition, "gte") && !(value >= condition.gte)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(condition, "lt") && !(value < condition.lt)) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(condition, "lte") && !(value <= condition.lte)) {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(condition, "not")) {
      return !matchesScalar(value, condition.not);
    }

    if (Object.keys(condition).length === 0) {
      return true;
    }

    if (!isOperatorObject(condition)) {
      return Object.entries(condition).every(([k, v]) => {
        const nestedValue = value == null ? undefined : value[k];
        return matchesScalar(nestedValue, v);
      });
    }

    return true;
  }

  return value === condition;
}

function compareValues(a, b, direction) {
  if (a === b) {
    return 0;
  }
  if (a == null) {
    return direction === "desc" ? 1 : -1;
  }
  if (b == null) {
    return direction === "desc" ? -1 : 1;
  }
  if (a > b) {
    return direction === "desc" ? -1 : 1;
  }
  return direction === "desc" ? 1 : -1;
}

function sortDocs(docs, orderBy) {
  if (!orderBy) {
    return docs;
  }

  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return docs.sort((left, right) => {
    for (const clause of clauses) {
      const [field, direction] = Object.entries(clause)[0];
      const cmp = compareValues(left[field], right[field], direction || "asc");
      if (cmp !== 0) {
        return cmp;
      }
    }
    return 0;
  });
}

async function readModelDocs(modelName) {
  const database = await ensureConnected();
  const collectionName = MODEL_TO_COLLECTION[modelName] || modelName;
  const rows = await database.collection(collectionName).find({}).toArray();
  return rows.map((row) => {
    const cloned = { ...row };
    delete cloned._id;
    return cloned;
  });
}

async function getRelatedDocs(modelName, doc, relationName) {
  const relation = RELATIONS[modelName] && RELATIONS[modelName][relationName];
  if (!relation) {
    return [];
  }

  const related = await readModelDocs(relation.model);
  if (relation.type === "one") {
    return related.filter((item) => item[relation.targetField] === doc[relation.sourceField]).slice(0, 1);
  }
  return related.filter((item) => item[relation.targetField] === doc[relation.sourceField]);
}

async function matchesWhere(modelName, doc, where) {
  if (!where) {
    return true;
  }

  const normalized = normalizeWhere(where);
  const entries = Object.entries(normalized);

  for (const [key, value] of entries) {
    if (key === "OR") {
      const conditions = Array.isArray(value) ? value : [];
      let any = false;
      for (const condition of conditions) {
        if (await matchesWhere(modelName, doc, condition)) {
          any = true;
          break;
        }
      }
      if (!any) {
        return false;
      }
      continue;
    }

    if (key === "AND") {
      const conditions = Array.isArray(value) ? value : [];
      for (const condition of conditions) {
        if (!(await matchesWhere(modelName, doc, condition))) {
          return false;
        }
      }
      continue;
    }

    if (key === "NOT") {
      const conditions = Array.isArray(value) ? value : [value];
      for (const condition of conditions) {
        if (await matchesWhere(modelName, doc, condition)) {
          return false;
        }
      }
      continue;
    }

    const relation = RELATIONS[modelName] && RELATIONS[modelName][key];
    if (relation) {
      const relatedDocs = await getRelatedDocs(modelName, doc, key);

      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (Object.prototype.hasOwnProperty.call(value, "some")) {
          let someMatch = false;
          for (const relatedDoc of relatedDocs) {
            if (await matchesWhere(relation.model, relatedDoc, value.some)) {
              someMatch = true;
              break;
            }
          }
          if (!someMatch) {
            return false;
          }
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(value, "none")) {
          for (const relatedDoc of relatedDocs) {
            if (await matchesWhere(relation.model, relatedDoc, value.none)) {
              return false;
            }
          }
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(value, "every")) {
          for (const relatedDoc of relatedDocs) {
            if (!(await matchesWhere(relation.model, relatedDoc, value.every))) {
              return false;
            }
          }
          continue;
        }

        if (relation.type === "one") {
          const relatedDoc = relatedDocs[0] || null;
          if (!relatedDoc) {
            return false;
          }
          if (!(await matchesWhere(relation.model, relatedDoc, value))) {
            return false;
          }
          continue;
        }
      }

      continue;
    }

    if (!matchesScalar(doc[key], value)) {
      return false;
    }
  }

  return true;
}

async function countForSelect(modelName, doc, countSpec) {
  if (!countSpec || typeof countSpec !== "object") {
    return {};
  }
  const selected = countSpec.select || {};
  const out = {};

  for (const [relationName, spec] of Object.entries(selected)) {
    const relation = RELATIONS[modelName] && RELATIONS[modelName][relationName];
    if (!relation) {
      out[relationName] = 0;
      continue;
    }

    const relatedDocs = await getRelatedDocs(modelName, doc, relationName);
    if (spec === true) {
      out[relationName] = relatedDocs.length;
      continue;
    }

    if (spec && typeof spec === "object" && spec.where) {
      let count = 0;
      for (const item of relatedDocs) {
        if (await matchesWhere(relation.model, item, spec.where)) {
          count += 1;
        }
      }
      out[relationName] = count;
      continue;
    }

    out[relationName] = relatedDocs.length;
  }

  return out;
}

async function applySelectAndInclude(modelName, doc, args = {}) {
  if (!doc) {
    return null;
  }

  const include = args.include || null;
  const select = args.select || null;

  let output;
  if (select) {
    output = {};
    for (const [field, spec] of Object.entries(select)) {
      if (field === "_count") {
        output._count = await countForSelect(modelName, doc, spec);
        continue;
      }

      const relation = RELATIONS[modelName] && RELATIONS[modelName][field];
      if (!relation) {
        if (spec) {
          output[field] = doc[field];
        }
        continue;
      }

      const relatedDocs = await getRelatedDocs(modelName, doc, field);
      if (relation.type === "one") {
        const relatedDoc = relatedDocs[0] || null;
        output[field] = spec === true ? relatedDoc : await applySelectAndInclude(relation.model, relatedDoc, spec || {});
      } else {
        const relatedOut = [];
        for (const relatedDoc of relatedDocs) {
          relatedOut.push(spec === true ? relatedDoc : await applySelectAndInclude(relation.model, relatedDoc, spec || {}));
        }
        output[field] = relatedOut;
      }
    }
  } else {
    output = { ...doc };
  }

  if (!include) {
    return output;
  }

  for (const [field, spec] of Object.entries(include)) {
    if (field === "_count") {
      output._count = await countForSelect(modelName, doc, spec);
      continue;
    }

    const relation = RELATIONS[modelName] && RELATIONS[modelName][field];
    if (!relation) {
      continue;
    }

    let relatedDocs = await getRelatedDocs(modelName, doc, field);
    if (spec && typeof spec === "object" && spec.where) {
      const filtered = [];
      for (const relatedDoc of relatedDocs) {
        if (await matchesWhere(relation.model, relatedDoc, spec.where)) {
          filtered.push(relatedDoc);
        }
      }
      relatedDocs = filtered;
    }

    if (spec && typeof spec === "object" && relation.type === "many") {
      relatedDocs = sortDocs(relatedDocs, spec.orderBy);
      if (typeof spec.skip === "number" && spec.skip > 0) {
        relatedDocs = relatedDocs.slice(spec.skip);
      }
      if (typeof spec.take === "number") {
        relatedDocs = relatedDocs.slice(0, spec.take);
      }
    }

    if (relation.type === "one") {
      const relatedDoc = relatedDocs[0] || null;
      output[field] = spec === true ? relatedDoc : await applySelectAndInclude(relation.model, relatedDoc, spec || {});
      continue;
    }

    const mapped = [];
    for (const relatedDoc of relatedDocs) {
      mapped.push(spec === true ? relatedDoc : await applySelectAndInclude(relation.model, relatedDoc, spec || {}));
    }
    output[field] = mapped;
  }

  return output;
}

async function createModelAccessor(modelName) {
  const database = await ensureConnected();
  const collectionName = MODEL_TO_COLLECTION[modelName] || modelName;
  return database.collection(collectionName);
}

function modelClient(modelName) {
  return {
    async findMany(args = {}) {
      const rows = await readModelDocs(modelName);
      const filtered = [];
      for (const row of rows) {
        if (await matchesWhere(modelName, row, args.where)) {
          filtered.push(row);
        }
      }

      let shaped = sortDocs(filtered, args.orderBy);
      if (typeof args.skip === "number" && args.skip > 0) {
        shaped = shaped.slice(args.skip);
      }
      if (typeof args.take === "number") {
        shaped = shaped.slice(0, args.take);
      }

      const out = [];
      for (const row of shaped) {
        out.push(await applySelectAndInclude(modelName, row, args));
      }
      return out;
    },

    async findFirst(args = {}) {
      const items = await this.findMany({ ...args, take: 1 });
      return items[0] || null;
    },

    async findUnique(args = {}) {
      const where = normalizeWhere(args.where || {});
      return this.findFirst({ ...args, where, take: 1 });
    },

    async create(args = {}) {
      const collection = await createModelAccessor(modelName);
      const now = new Date();
      const data = args.data || {};
      const doc = {
        id: data.id || randomUUID(),
        ...materializeDefaults(modelName),
        ...data,
      };

      if (!Object.prototype.hasOwnProperty.call(doc, "createdAt")) {
        doc.createdAt = now;
      }
      doc.updatedAt = now;

      await collection.insertOne(doc);
      return applySelectAndInclude(modelName, doc, args);
    },

    async createMany(args = {}) {
      const collection = await createModelAccessor(modelName);
      const rows = Array.isArray(args.data) ? args.data : [];
      if (rows.length === 0) {
        return { count: 0 };
      }

      const now = new Date();
      const docs = rows.map((row) => {
        const doc = {
          id: row.id || randomUUID(),
          ...materializeDefaults(modelName),
          ...row,
        };
        if (!Object.prototype.hasOwnProperty.call(doc, "createdAt")) {
          doc.createdAt = now;
        }
        doc.updatedAt = now;
        return doc;
      });

      await collection.insertMany(docs);
      return { count: docs.length };
    },

    async update(args = {}) {
      const collection = await createModelAccessor(modelName);
      const where = normalizeWhere(args.where || {});
      const existing = await this.findFirst({ where });
      if (!existing) {
        return null;
      }

      const next = {
        ...existing,
        ...(args.data || {}),
        updatedAt: new Date(),
      };

      await collection.updateOne({ id: existing.id }, { $set: next });
      return applySelectAndInclude(modelName, next, args);
    },

    async updateMany(args = {}) {
      const collection = await createModelAccessor(modelName);
      const current = await this.findMany({ where: args.where });
      if (current.length === 0) {
        return { count: 0 };
      }

      const ids = current.map((item) => item.id);
      const patch = {
        ...(args.data || {}),
        updatedAt: new Date(),
      };

      await collection.updateMany({ id: { $in: ids } }, { $set: patch });
      return { count: ids.length };
    },

    async delete(args = {}) {
      const collection = await createModelAccessor(modelName);
      const where = normalizeWhere(args.where || {});
      const existing = await this.findFirst({ where });
      if (!existing) {
        return null;
      }

      await collection.deleteOne({ id: existing.id });
      return existing;
    },

    async deleteMany(args = {}) {
      const collection = await createModelAccessor(modelName);
      const existing = await this.findMany({ where: args.where });
      const ids = existing.map((item) => item.id);
      if (ids.length === 0) {
        return { count: 0 };
      }
      await collection.deleteMany({ id: { $in: ids } });
      return { count: ids.length };
    },

    async upsert(args = {}) {
      const where = normalizeWhere(args.where || {});
      const existing = await this.findFirst({ where });
      if (existing) {
        return this.update({ where: { id: existing.id }, data: args.update || {}, select: args.select, include: args.include });
      }
      return this.create({ data: args.create || {}, select: args.select, include: args.include });
    },

    async count(args = {}) {
      const rows = await this.findMany({ where: args.where });
      return rows.length;
    },

    async groupBy(args = {}) {
      const rows = await this.findMany({ where: args.where });
      const by = Array.isArray(args.by) ? args.by : [];
      const grouped = new Map();

      for (const row of rows) {
        const key = JSON.stringify(by.map((field) => row[field]));
        if (!grouped.has(key)) {
          const seed = {};
          for (const field of by) {
            seed[field] = row[field];
          }
          seed._count = {};
          grouped.set(key, seed);
        }

        const bucket = grouped.get(key);
        if (args._count === true) {
          bucket._count._all = (bucket._count._all || 0) + 1;
        } else if (args._count && typeof args._count === "object") {
          for (const countField of Object.keys(args._count)) {
            bucket._count[countField] = (bucket._count[countField] || 0) + 1;
          }
        }
      }

      return Array.from(grouped.values());
    },
  };
}

const MODEL_NAMES = Object.keys(MODEL_TO_COLLECTION);
const dbClient = {};

for (const modelName of MODEL_NAMES) {
  dbClient[modelName] = modelClient(modelName);
}

dbClient.$disconnect = async () => {
  if (!db) {
    return;
  }
  await mongoose.disconnect();
  db = null;
};

dbClient.$transaction = async (payload) => {
  if (typeof payload === "function") {
    return payload(dbClient);
  }
  if (Array.isArray(payload)) {
    return Promise.all(payload);
  }
  return payload;
};

module.exports = dbClient;
