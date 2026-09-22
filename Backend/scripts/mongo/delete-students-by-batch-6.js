#!/usr/bin/env node
/*
 * One-off bulk student deletion by BATCH NAME (Batch 6).
 *
 * Deletes every student that belongs to the target batch (matched on either the
 * legacy scalar `batchId` or the `batchIds` array), mirroring the Super Admin
 * "delete student" behavior exactly:
 *   - deletes ONLY the student document (no cascade of submissions/violations)
 *   - revokes the student's refresh tokens (DB + auth cache)
 *   - writes a SUPER_ADMIN_DELETE_STUDENT audit log per student
 *
 * SAFE BY DEFAULT: without --confirm it runs a DRY RUN and deletes nothing.
 *
 * Usage (run on the server, inside the API container):
 *   node scripts/mongo/delete-students-by-batch-6.js              # dry run / report
 *   node scripts/mongo/delete-students-by-batch-6.js --confirm    # actually delete
 */

require("dotenv").config();

const dbClient = require("../../src/config/db");
const { invalidateRefreshTokenRecord } = require("../../src/services/refresh-token-cache.service");
const { bumpPrincipalTokenVersion } = require("../../src/services/auth-revocation.service");
const { createAuditLog } = require("../../src/services/audit.service");

const TARGET_BATCH = "MEC THIRD YR BATCH 6 - AUG 2026";

// From "MEC_THIRD_YR_BATCH_6_AUG_2026_FORMATTED (1).xlsx" (42 unique) — cross-check only.
const SHEET_EMAILS = new Set(
  [
    "ellammalbalaraman2007@gmail.com", "subathranatarajan18@gmail.com", "sugavahan@gmail.com",
    "sivabalankiran0938@gmail.com", "sarvalakshmi70@gmail.com", "suriyasathiya154@gmail.com",
    "sivasakthimaha05@gmail.com", "uvayuvasri99@gmail.com", "durgasd556@gmail.com",
    "akshaiyaarjunan@gmail.com", "m.suganthi2162006@gmail.com", "ttharundhanush@gmail.com",
    "rdharshinipriya53@gmail.com", "deepanlove186@gmail.com", "saranya83487@gmail.com",
    "subashjsubash2@gmail.com", "vibushnan39@gmail.com", "vm510115@gmail.com",
    "reenaraphaelraj@gmail.com", "vigneshkumar.skm@gmail.com", "anjujagan2005@gmail.com",
    "uthiravelsanthosh@gmail.com", "divyadharshinimurugan5@gmail.com", "alogeshw49@gmail.com",
    "pilamathi071@gmail.com", "deepakkalimuthu2006@gmail.com", "ghayathiryghayu@gmail.com",
    "subasrisekar2007@gmail.com", "sriharini5666@gmail.com", "velann55@gmail.com",
    "ilavarasi1719@gmail.com", "anantheeshwaran01@gmail.com", "gl8784759@gmail.com",
    "subasrisivakumar15@gmail.com", "vidhyaa396@gmail.com", "sivasakthi2007ramakrishnan@gmail.com",
    "sadhanasadhana5492@gmail.com", "shrinidhiramadoss28@gmail.com", "sandhiya2412007@gmail.com",
    "akshayasachi06@gmail.com", "kfazuludheen@gmail.com", "bhuvanikasivakmar28@gmail.com",
  ].map((e) => e.trim().toLowerCase()),
);

const revokeStudentRefreshTokens = async (db, studentId) => {
  try {
    await bumpPrincipalTokenVersion(db, "student", studentId);
  } catch (err) {
    console.warn(`  ! token-version bump failed (non-fatal): ${err.message}`);
  }
  const activeTokens = await db.studentRefreshToken.findMany({
    where: { userId: studentId, revokedAt: null },
  });
  await db.studentRefreshToken.updateMany({
    where: { userId: studentId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await Promise.all(
    activeTokens.map((record) =>
      invalidateRefreshTokenRecord("student", record).catch((err) =>
        console.warn(`  ! refresh-token cache invalidation failed (non-fatal): ${err.message}`),
      ),
    ),
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const db = dbClient;

  console.log(`\nTarget DB: ${process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/\/\/[^@]*@/, "//***:***@") : "(unset)"}`);
  console.log(`Target batch: "${TARGET_BATCH}"`);
  console.log(`Mode: ${confirm ? "DELETE (--confirm)" : "DRY RUN (no changes)"}\n`);

  // 1) Resolve the batch(es) by name.
  const batches = await db.batch.findMany({
    where: { name: { equals: TARGET_BATCH, mode: "insensitive" } },
  });
  if (batches.length === 0) {
    console.error(`No batch found with name "${TARGET_BATCH}". Nothing to do.`);
    process.exit(1);
  }
  console.log(`Matched ${batches.length} batch record(s):`);
  for (const b of batches) {
    console.log(`  - id=${b.id} name="${b.name}" collegeId=${b.collegeId || "-"} departmentId=${b.departmentId || "-"}`);
  }
  const batchIds = batches.map((b) => b.id);

  // 2) Find all students in the batch (legacy scalar OR array membership).
  const students = await db.student.findMany({
    where: { OR: [{ batchId: { in: batchIds } }, { batchIds: { in: batchIds } }] },
  });

  // Resolve every referenced batch name for display / multi-batch detection.
  const allBatchIds = [...new Set(students.flatMap((s) => [s.batchId, ...(s.batchIds || [])].filter(Boolean)))];
  const batchNameById = {};
  for (const bid of allBatchIds) {
    const b = await db.batch.findUnique({ where: { id: bid } });
    if (b) batchNameById[bid] = b.name;
  }
  const otherBatchNames = (s) =>
    [...new Set([s.batchId, ...(s.batchIds || [])].filter(Boolean))]
      .filter((bid) => !batchIds.includes(bid))
      .map((bid) => batchNameById[bid] || `<${bid}>`);

  console.log(`\n=== STUDENTS IN BATCH (${students.length}) ===`);
  const foundEmails = new Set();
  for (const s of students) {
    const email = (s.email || "").toLowerCase();
    foundEmails.add(email);
    const others = otherBatchNames(s);
    const multi = others.length ? `  <== ALSO IN: [${others.join(", ")}]` : "";
    const notInSheet = SHEET_EMAILS.has(email) ? "" : "  <== NOT IN SPREADSHEET";
    console.log(`  ${s.email} | ${s.fullName} | enroll=${s.enrollNumber || "-"} | status=${s.lifecycleStatus}${multi}${notInSheet}`);
  }

  // 3) Cross-check: sheet emails not present in the batch.
  const missingFromBatch = [...SHEET_EMAILS].filter((e) => !foundEmails.has(e));

  console.log(`\n=== CROSS-CHECK vs SPREADSHEET ===`);
  console.log(`  Students in batch:            ${students.length}`);
  console.log(`  Spreadsheet unique emails:    ${SHEET_EMAILS.size}`);
  console.log(`  In batch but NOT in sheet:    ${students.length - [...foundEmails].filter((e) => SHEET_EMAILS.has(e)).length}`);
  console.log(`  In sheet but NOT in batch:    ${missingFromBatch.length}`);
  if (missingFromBatch.length) missingFromBatch.forEach((e) => console.log(`      - ${e}`));

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Will delete: ${students.length} student(s) belonging to the batch.`);

  if (!confirm) {
    console.log(`\nDRY RUN complete. No records were changed.`);
    console.log(`Re-run with --confirm to delete the ${students.length} student(s) above.\n`);
    process.exit(0);
  }

  console.log(`\n=== DELETING ${students.length} STUDENT(S) ===`);
  let deleted = 0;
  const failures = [];
  for (const s of students) {
    try {
      await db.student.delete({ where: { id: s.id } });
      await revokeStudentRefreshTokens(db, s.id);
      await createAuditLog({
        action: "SUPER_ADMIN_DELETE_STUDENT",
        targetType: "STUDENT",
        targetId: s.id,
        collegeId: s.collegeId,
        superAdminId: null,
        beforeState: s,
        afterState: null,
      });
      deleted += 1;
      console.log(`  deleted: ${s.email} (${s.fullName})`);
    } catch (err) {
      failures.push({ email: s.email, error: err.message });
      console.error(`  FAILED:  ${s.email} -> ${err.message}`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Deleted: ${deleted}/${students.length}`);
  if (failures.length) {
    console.log(`  Failures: ${failures.length}`);
    failures.forEach((f) => console.log(`      - ${f.email}: ${f.error}`));
  }
  process.exit(failures.length ? 1 : 0);
};

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
