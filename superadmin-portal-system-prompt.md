# SuperAdmin Portal — Full System Design Prompt
### LMS Portal · MERN + Tailwind + shadcn + Redux Toolkit · JWT Auth
### Platform-Wide Authority · 5 Colleges · Zero Trust · Production-Grade

---

## ROLE & CONTEXT

The SuperAdmin is the **platform owner**. They operate above all college boundaries. They can see, create, modify, and delete any entity across all 5 colleges. They create Admin accounts and control what those admins can do. They create cross-college tests, monitor the entire platform, manage system health, and act as the last line of escalation for anomalies, disputes, and configuration.

There is exactly **one** SuperAdmin role class but potentially multiple SuperAdmin accounts (e.g. a CTO + a platform manager). Every SuperAdmin action is visible to every other SuperAdmin via audit logs. SuperAdmin accounts cannot be created from within the portal — they are seeded directly into the database by a system operator with server access. This is intentional: no UI-level privilege escalation path exists.

The SuperAdmin portal is a **control plane**, not a consumer application. It prioritises operational clarity, bulk management, real-time oversight, and investigative capability. Every design decision must answer: "What does a platform operator need at 2 AM when something breaks?"

---

## CORE ARCHITECTURAL PRINCIPLES

### Principle 1 — No College Scope Filter; Explicit College Selection
Unlike admin requests that are auto-scoped to `college_id` from JWT, SuperAdmin requests are unscoped by default. Every query returns data across all colleges. When the SuperAdmin filters by college, they pass `college_id` as an explicit query param — validated server-side to exist, but not restricted. The middleware distinguishes:

```ts
export const applyScopeFilter = (req: Request, res: Response, next: NextFunction) => {
  if (req.user.role === 'superadmin') {
    // Optional scoping — SuperAdmin can filter down voluntarily
    req.scopeFilter = req.query.college_id
      ? { college_id: req.query.college_id }
      : {};  // empty = all colleges
  } else {
    // Admin — mandatory scoping from token
    req.scopeFilter = { college_id: req.user.college_id };
  }
  next();
};
```

### Principle 2 — Every Destructive Action Has a Typed Acknowledgment
Actions that cannot be undone (deactivate an admin who has live tests, delete a college's data, force-submit all active attempts) require the SuperAdmin to type a specific string. Not just "CONFIRM" — the string encodes what they're confirming: `"DELETE college-a"` or `"DEACTIVATE adm_001"`. This string is validated server-side. No exceptions.

### Principle 3 — Impersonation is Read-Only and Fully Logged
SuperAdmin can view the portal as any admin or student. Every impersonation session is logged — who was impersonated, by whom, when, for how long, and what pages were viewed. Impersonation mode disables all write operations client-side and server-side (every impersonated request carries `X-Impersonation-Session: {session_id}` — the server rejects writes with this header present).

### Principle 4 — Platform Health is a First-Class Feature
The SuperAdmin dashboard is an operational dashboard first, a management dashboard second. Failed job counts, socket connection counts, database response times, active test counts, and violation rates across all colleges are visible without navigating away from the home screen.

### Principle 5 — Cross-College Operations Require Explicit Target Selection
When a SuperAdmin creates a cross-college test, sends a platform announcement, or runs a bulk report across colleges, they must explicitly select which colleges are in scope. The system never applies a cross-college operation to all colleges silently. The UI always shows: "This action affects [College A, College B, College C]. Confirm."

---

## AUTHENTICATION & SESSION SECURITY

### JWT Payload for SuperAdmin
```ts
interface SuperAdminJWTPayload {
  sub: string;
  role: 'superadmin';
  superadmin_id: string;
  session_id: string;          // unique per login — for audit log correlation
  mfa_verified: boolean;       // SuperAdmin requires MFA
  iat: number;
  exp: number;                 // 15-minute access token (same as admin)
}
```

### Multi-Factor Authentication (MFA) — Mandatory
SuperAdmin login is a two-step process:
1. `POST /auth/superadmin/login { email, password }` → returns `{ mfa_challenge_token }` (short-lived, 5 minutes).
2. `POST /auth/superadmin/mfa/verify { mfa_challenge_token, totp_code }` → returns `{ access_token }` + sets `refresh_token` httpOnly cookie.

TOTP via Google Authenticator / Authy. Backup codes: 10 single-use codes generated at MFA setup, stored as bcrypt hashes in the DB. If a backup code is used, notify via email: "A backup code was used to access your SuperAdmin account."

If MFA is bypassed somehow (token manipulation), the server middleware checks `mfa_verified: true` on every SuperAdmin route. A token without `mfa_verified` is treated as unauthorised for SuperAdmin endpoints.

### Session Management
- SuperAdmin sessions are tracked in a `SuperAdminSessions` collection: `{ session_id, superadmin_id, ip_address, user_agent, created_at, last_active_at, revoked: boolean }`.
- On every SuperAdmin request, middleware updates `last_active_at` and checks `revoked`. If another SuperAdmin has revoked this session (e.g. suspected account compromise), the request fails with 401 `SESSION_REVOKED`.
- SuperAdmin can view and revoke all their own active sessions from Settings.

### Edge Cases — Auth
- **SuperAdmin account compromised**: another SuperAdmin can deactivate the account from User Management. The deactivated account's refresh token is invalidated by adding `superadmin_id` to a Redis blocklist checked on every token refresh.
- **MFA device lost**: only via server-side operator intervention (not a portal UI action) — this is intentional. There is no "forgot MFA" self-service flow for SuperAdmin. This prevents social engineering attacks.
- **Brute force on TOTP**: after 5 failed TOTP attempts, lock the MFA challenge token (not the account). The SuperAdmin must start a new login flow. Log all failed attempts.

---

## SUPERADMIN LAYOUT ARCHITECTURE

### Shell Structure
```
SuperAdminShell
├── TopBar (fixed)
│   ├── Platform name + environment badge (PRODUCTION / STAGING)
│   ├── Platform-wide search (Cmd+K)
│   ├── Alert center (platform health alerts)
│   ├── Impersonation indicator (persistent banner if in impersonation mode)
│   └── SuperAdmin avatar + session info + logout
├── Sidebar (260px / 64px collapsed)
│   ├── Dashboard (platform overview)
│   ├── Colleges (manage all 5 colleges)
│   ├── Users (admins + students across all colleges)
│   ├── Tests (cross-college test management)
│   ├── Reports (platform-wide analytics)
│   ├── System (jobs, health, audit logs, feature flags)
│   └── Settings (SuperAdmin account + platform config)
└── Main <Outlet />
```

### Environment Badge
- Production environment: red badge `PROD` in the top bar. This is a visual safeguard — the SuperAdmin should always know which environment they're operating in.
- Staging/development environments show a yellow `STAGING` or `DEV` badge.
- Implemented via `VITE_ENVIRONMENT` env variable injected at build time.

### Impersonation Banner
When an impersonation session is active, a persistent amber banner spans the full width at the top of every page:
```
[Impersonation mode] Viewing as: Rajesh Kumar (Admin · College A) — All writes are disabled — Exit
```
This banner cannot be dismissed. Exit calls `POST /superadmin/impersonate/end { session_id }`, logs the session end, and restores the normal SuperAdmin view.

### Platform-Wide Search (Cmd+K)
Searches across all colleges simultaneously:
- Admins by name/email
- Students by name/roll number (shows their college)
- Tests by name (shows which college)
- Colleges by name
- Audit log entries (full-text on `action` field)

Results grouped by category. Each result shows a college tag so the SuperAdmin knows which institution the entity belongs to. Clicking a student from College B in search navigates to that student's profile — the college context is loaded from the result, not from a persisted selection.

---

## DASHBOARD — PLATFORM COMMAND CENTER

### Top Row — Real-Time KPIs (WebSocket-driven)
```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Active Tests    │ Students Online │ Submissions/hr  │ System Health   │
│ 7 across 3      │ 342 right now   │ 128 this hour   │ All systems OK  │
│ colleges        │                 │                 │                 │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

All four KPI cards update via Socket.io events emitted by the server:
- `platform_test_status_change` — a test went live or completed
- `student_attempt_started` — a new attempt began
- `student_attempt_submitted` — a submission recorded
- `system_health_update` — every 30 seconds

### College Health Grid (Second Row)
One card per college showing:
- Active tests right now
- Students active right now
- Avg score this month
- Admin account status (active / any deactivated)
- Last test published (timestamp)

Clicking a college card deep-links to College Detail page with that college pre-selected.

### Live Violations Feed (Third Row)
Real-time stream of proctoring violations across all colleges:
```
10:42:31 AM  Priya Rajan (College A)  Tab Switch  [Unit 3 OS Test]
10:42:28 AM  Hari Prasad (College C)  Copy/Paste  [Algorithms Mid-Term]
10:42:20 AM  Meena K (College A)     Auto-Submit  [Unit 3 OS Test]  ← threshold exceeded
```
Auto-submit events are highlighted in red. SuperAdmin can click any row to open the attempt record without leaving the dashboard.

Capped at the last 50 violations in the feed. Older violations scroll off. Full violation history is in Reports.

### System Health Panel (Bottom Row)
```ts
interface SystemHealth {
  mongodb: { status: 'ok' | 'degraded' | 'down'; avg_response_ms: number; };
  redis: { status: 'ok' | 'degraded' | 'down'; hit_rate: number; };
  job_queue: { pending: number; failed_last_hour: number; oldest_pending_age_ms: number; };
  socket_server: { connected_clients: number; };
  storage: { used_gb: number; total_gb: number; percent_used: number; };
  api: { avg_response_ms: number; error_rate_percent: number; requests_per_minute: number; };
}
```
`GET /superadmin/system/health` — polled every 30 seconds. If any service is `degraded` or `down`, show a platform alert (bell icon turns red, persistent banner).

**Edge Case**: system health endpoint itself is down. The client detects the fetch error and shows: "Health check unavailable. This may indicate a server connectivity issue." Don't show a false green when you can't reach the health endpoint.

---

## COLLEGE MANAGEMENT

### College List Page
Table: College Name | Slug | Active Admins | Total Students | Tests Created | Status (active/suspended) | Actions.

### Create College
```ts
interface CollegeCreatePayload {
  name: string;                       // "St. Xavier's Engineering College"
  slug: string;                       // "st-xaviers-ec" — URL-safe, unique, immutable after creation
  logo_url: string;                   // uploaded to CDN first
  primary_color: string;              // hex — used in student portal branding
  departments: string[];              // ["CSE", "ECE", "MECH", "CIVIL", "IT"]
  academic_year_format: string;       // "YYYY-YYYY" — for validation
  timezone: string;                   // "Asia/Kolkata" — for display defaults
  contact_email: string;              // college admin contact, not a user account
  max_admins: number;                 // platform-enforced limit (default: 5)
  max_students: number;               // platform-enforced limit (default: 2000)
  feature_flags: CollegeFeatureFlags; // which platform features this college has access to
}

interface CollegeFeatureFlags {
  events_enabled: boolean;
  leaderboard_enabled: boolean;
  bulk_student_import: boolean;
  anomaly_detection: boolean;
  custom_branding: boolean;
  api_webhooks: boolean;
}
```

**Slug is immutable** after creation — it's used in URLs, internal references, and potentially external integrations. Show a permanent warning in the creation form: "The slug cannot be changed after creation. Choose carefully."

**Departments are append-only** after student data exists. You can add new departments. You cannot rename or delete a department that has students assigned to it — that would orphan student records. Renaming creates a new department and migrates students in a background job with explicit SuperAdmin confirmation.

### College Detail Page
Deep dive into one college:
- All admin accounts for this college (create/edit/deactivate from here)
- Student count by department (bar chart)
- Test activity timeline (tests created/published/completed over the last 90 days)
- Storage usage for this college's uploads
- Feature flags toggle (granular per-college)
- Danger zone: suspend college, export all college data, reset college data (extreme action — see below)

### Suspend vs Delete College
- **Suspend** (`PATCH /colleges/:id { status: 'suspended' }`): all admin logins for this college return 403 `COLLEGE_SUSPENDED`. Students cannot access the portal. All scheduled tests are paused — their `start_date` effectively becomes unreachable while suspended. Tests in progress (live) are NOT auto-submitted — the suspension blocks new access but doesn't terminate existing sessions (too dangerous). After un-suspension, the platform resumes from where it left off.
- **Delete** college: not a UI operation. Requires a database-level operation by a server operator. The SuperAdmin portal has no delete college button. This is intentional — college data includes student records, exam history, and potentially legal obligations. A UI button that could delete all of this is an unacceptable risk surface.

### Export All College Data
`POST /superadmin/colleges/:id/export` — async job. Creates a zip file containing:
- All student accounts (CSV)
- All tests and questions (JSON)
- All attempt records with scores (CSV)
- All audit logs for this college (CSV)
- All event registrations (CSV)

Used for data portability, GDPR compliance, or offboarding a college from the platform.

---

## USER MANAGEMENT — ADMINS

### Admin List (All Colleges)
Table with college filter: Name | Email | College | Permissions | Status | Last Login | Actions.

Default sort: last login ascending (admins who haven't logged in recently at top — likely inactive accounts needing review).

### Create Admin Account
```ts
interface AdminCreatePayload {
  name: string;
  email: string;
  college_id: string;               // must exist
  temporary_password: string;       // auto-generated, shown once, emailed
  permissions: Permission[];        // granular — see admin portal spec
  send_welcome_email: boolean;
}
```

**Password generation**: `crypto.randomBytes(12).toString('base64')` — 16-character random string. Shown once in a modal after creation: "Copy this password — it will not be shown again." Stored as bcrypt hash in DB. Admin must change it on first login (enforced via `force_password_change: true` flag on user document).

**Permission assignment UI**: checkbox group with permission categories:
```
Test Management:   [✓] create_test  [✓] edit_test  [✓] delete_test  [✓] publish_test
Questions:         [✓] manage_questions
Students:          [✓] manage_students  [✓] bulk_import
Batches:           [✓] manage_batches
Events:            [✓] manage_events
Reports:           [✓] view_reports  [ ] export_reports
```

"Select All" and "Deselect All" shortcuts. Preset buttons: "Full Access" / "Test Manager" / "Report Viewer" / "Custom".

**Edge Cases — Create Admin**
- Email already exists (another admin at a different college with same email): block. Email must be globally unique across the platform. "This email is already registered to an admin at [College B]."
- SuperAdmin creates an admin with no permissions: allow it (the admin can log in but can't do anything). Warn: "This admin has no permissions. They will be able to log in but will see empty screens."
- College is at `max_admins` limit: block creation. Show: "College A has reached its admin account limit (5). Increase the limit in College Settings or deactivate an existing admin."

### Edit Admin Permissions
`PATCH /superadmin/users/:id/permissions { permissions: [] }` — partial update.

If the permission being removed is for something the admin is currently doing (e.g. they have the test creation wizard open and `create_test` is removed):
- The change takes effect immediately on the server (token is re-validated on next API call).
- The admin's next API call will fail with 403.
- Client shows: "Your permissions have been updated. Some features are no longer available."

**Downgrading mid-action edge cases**:
- Admin has a live test running and `publish_test` is removed: the existing live test is unaffected. The permission removal only blocks future publishes.
- Admin is in the middle of a bulk import and `bulk_import` is removed: the current job continues to completion (it's already running server-side). Only new job initiations are blocked.

### Deactivate Admin
`PATCH /superadmin/users/:id { active: false }`.

**Pre-deactivation check**: `GET /superadmin/users/:id/impact-analysis` returns:
```ts
{
  active_tests: Test[];           // tests currently live
  scheduled_tests: Test[];        // upcoming tests
  in_progress_wizard: boolean;    // have an unsaved draft?
  recent_batch_operations: BatchOp[];
}
```

Show an impact summary modal: "Deactivating Rajesh Kumar will affect: 2 live tests (they will continue unaffected), 3 scheduled tests (they will remain scheduled — no admin needed for them to run). Proceed?"

After deactivation: admin sessions are immediately terminated (refresh token invalidated via Redis blocklist). Live and scheduled tests continue running independently — they don't need the admin to be active.

### Transfer Test Ownership
When an admin is deactivated and they own tests, SuperAdmin can reassign: `PATCH /tests/:id { created_by: new_admin_id }`. This is a bulk action available from the deactivation confirmation modal: "Assign these 3 tests to: [admin dropdown]."

---

## USER MANAGEMENT — STUDENTS

### Student List (All Colleges)
Table with mandatory college filter (all-colleges view would be too large — default to first college, with a dropdown to switch).

Columns: Roll No | Name | Email | Department | Batch | Tests Taken | Avg Score | Last Active | Status.

Inline actions: View Profile, Impersonate, Deactivate, Reset Password.

### Student Detail Page (SuperAdmin View)
Extends the admin view with additional capabilities:
- Full attempt history across all tests (admin can only see their college's tests — SuperAdmin sees everything if the student somehow has attempts at multiple colleges, which shouldn't happen by design but is logged if it does).
- Violation history across all attempts.
- Account metadata: created_at, created_by (which admin imported them), login history (last 10 IP addresses).
- Danger zone: Deactivate account, Reset password, Force logout all sessions.

### Force Logout All Sessions
`POST /superadmin/students/:id/revoke-sessions` — adds `student_id` to a Redis blocklist. Every subsequent request from this student (even with a valid token) returns 401 `SESSION_REVOKED`. The student must log in again.

Use case: suspected account sharing (one student sharing login with another).

### Bulk Student Operations (Cross-College)
SuperAdmin can run platform-wide operations:
- Export all students across all colleges (for platform analytics, shared with college management teams).
- Bulk deactivate students matching a filter (e.g. all students in a specific graduation year who are now alumni).
- Send platform-wide announcement (stored notification, not email — see Announcements section).

---

## CROSS-COLLEGE TEST MANAGEMENT

### Design Principle
A cross-college test is a single `Test` document with college-specific overrides in `college_assignments`. This avoids duplicating the question bank (which could be 500 questions) for each college.

```ts
interface CrossCollegeTest extends Test {
  scope: 'cross_college';
  college_assignments: CollegeAssignment[];
}

interface CollegeAssignment {
  college_id: string;
  departments: string[];            // which departments within this college
  batch_ids: string[];              // specific batches (optional)
  start_date: string;               // college-specific schedule
  end_date: string;
  max_attempts_override: number | null;   // null = use test default
  time_limit_override: number | null;     // null = use test default
  proctoring_override: Partial<ProctoringConfig> | null; // null = use test default
  status: 'scheduled' | 'live' | 'completed'; // per-college status
}
```

### Cross-College Test Creation Wizard
Same 6-step structure as the admin wizard, with two additional steps:

**Step 2 — College Assignment** (replaces the admin's single-college assignment):
- Multi-select college cards (show logo, name, admin count, student count).
- For each selected college, expand an inline config panel:
  - Departments (multi-select from that college's departments)
  - Batches (optional)
  - Date range (per-college — can differ)
  - Overrides (max attempts, time limit, proctoring)
- Student count preview updates as selections change: "This test will reach 847 students across 3 colleges."

**Step 4.5 — Conflict Check** (between review and proctoring):
Before proctoring config, run: `POST /superadmin/tests/cross-college/conflict-check { college_assignments }`.

Server checks:
- Any of these colleges already have a live or scheduled test that overlaps in date with this assignment?
- Any student (by batch) already has a test at the same time?

Returns a conflict report. SuperAdmin must acknowledge each conflict before proceeding. Conflicts don't block publishing but require explicit sign-off.

### Live Edit on Live Cross-College Test
When a cross-college test is live for College A but not yet started for College B:
- Editing questions is blocked (as always when any college is live).
- Editing College B's schedule (not yet live) is allowed.
- Editing College A's schedule is blocked (live).

Server enforces this: `PATCH /superadmin/tests/:id/college-assignments/:college_id` checks `college_assignment.status !== 'live'` before allowing date changes.

**Typed acknowledgment for question edit on live cross-college test**:
"Type the test name to confirm editing questions during a live exam: ____"
Server validates the typed string matches the test name. All live attempts for this test are flagged with `edited_during_live: true` in their records.

---

## ANNOUNCEMENTS SYSTEM

### Announcement Model
```ts
interface Announcement {
  _id: string;
  title: string;
  body: string;                     // rich text (HTML, sanitized)
  created_by: string;               // superadmin_id
  scope: AnnouncementScope;
  priority: 'low' | 'normal' | 'high' | 'critical';
  delivery: AnnouncementDelivery;
  status: 'draft' | 'scheduled' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  read_count: number;               // updated via background aggregation
  created_at: string;
}

interface AnnouncementScope {
  type: 'all_colleges' | 'specific_colleges' | 'specific_departments' | 'specific_batches' | 'role';
  college_ids?: string[];
  department_filters?: { college_id: string; departments: string[] }[];
  batch_ids?: string[];
  role?: 'admin' | 'student' | 'both';
}

interface AnnouncementDelivery {
  in_app: boolean;                  // stored notification in DB — always true for non-draft
  email: boolean;                   // sends via email provider (future feature, flag for now)
  banner: boolean;                  // shows a dismissible banner on next login
}
```

### Compose & Send Flow
1. SuperAdmin composes announcement with rich text editor.
2. Selects scope (who receives it).
3. Selects priority and delivery method.
4. Preview: "This announcement will be sent to 1,247 students and 18 admins across College A and College B."
5. Option to schedule or send immediately.
6. On send: `POST /superadmin/announcements` → server enqueues a Bull job to create notification records for all target users in batches of 500 (not all at once — prevent DB write spike).

### Edge Cases — Announcements
- **Scope changes 2000 students**: job creates 2000 notification records. If the job fails midway, it must be idempotent — use a `batch_id` on each notification record and process in chunks with `upsert` semantics.
- **Admin-scope announcement while admin is mid-test-creation**: the announcement appears in their notification bell on next API call. The bell count updates via the next Socket.io push. Their wizard is unaffected.
- **Announcement sent to 0 recipients**: server validates recipient count > 0 before allowing send. "No users match this scope."
- **Cancel a scheduled announcement**: allowed anytime before `scheduled_at`. If the scheduler has already picked it up and is 80% through sending: server marks it `cancelled`, the job checks the `status` field before creating each batch of notifications — stops on `cancelled`.

---

## PLATFORM-WIDE REPORTS

### Report Hierarchy
```
Platform Level (SuperAdmin only)
  └── College Level (SuperAdmin can access any college)
        └── Department Level (SuperAdmin + Admin)
              └── Batch Level (SuperAdmin + Admin)
                    └── Student Level (SuperAdmin + Admin)
```

### Platform Analytics Dashboard
Route: `/reports/platform`

Charts:
- **Submission volume over time** (line chart, daily, last 90 days) — all colleges stacked.
- **Average score by college** (horizontal bar chart) — college comparison.
- **Test participation rate** (students who attempted / students assigned, per test) — funnel view.
- **Violation rate by college** (violations per 100 students) — flag outliers.
- **Most common violation types** (pie chart across platform).

Data is pre-aggregated by a nightly cron job (`0 2 * * *` — 2 AM daily). The nightly job writes to a `PlatformAnalyticsSnapshot` collection. Report views read from this snapshot, not from raw attempt data. This means platform reports load in <500ms regardless of how many million attempts exist.

**Freshness indicator**: "Data as of 2:15 AM today. Next update in 11 hours." With a "Refresh now" button (triggers the aggregation job on demand, shows a loading state for ~30 seconds).

### Cross-College Leaderboard
SuperAdmin-only view: top performers across all 5 colleges on a specific test or across all tests.

Each student row shows their college tag. This data is never visible to students or admins (students only see their college's leaderboard). Privacy consideration: student names are shown in full to SuperAdmin (operational need), but if exported, the SuperAdmin must confirm: "This export includes student PII. Ensure you handle it per your data policy."

### Comparative College Report
Select two or more colleges and a date range:
- Side-by-side avg score comparison per test.
- Participation rates.
- Violation rates.
- Most/least active departments.

Generated as an async job (same pattern as admin report exports). Output: a structured PDF with charts rendered server-side via Puppeteer.

---

## SYSTEM MANAGEMENT

### Job Queue Monitor
Route: `/system/jobs`

Table of all Bull queue jobs across job types:
```
bulk_student_import | pending/active/completed/failed | college | created_at | progress | actions
report_export       | ...
announcement_send   | ...
anomaly_detection   | ...
nightly_aggregation | ...
```

Actions per job:
- **View logs**: raw job logs (stderr/stdout captured by Bull).
- **Retry**: for failed jobs. Show warning if the job is not idempotent: "This job type may create duplicate records if retried. Confirm?"
- **Cancel**: for pending/active jobs. If active (running), sends a cancellation signal — the job must check `job.isCancelled()` in its processing loop.

**Stuck jobs detection**: if a job has been `active` for > 5 minutes (configurable per job type), highlight it in red with: "Possibly stuck. Consider cancelling and retrying."

### Feature Flags
Per-college feature toggles (stored on `College` document) plus platform-wide flags (stored in a `PlatformConfig` singleton document):

```ts
interface PlatformConfig {
  maintenance_mode: boolean;           // if true, all non-superadmin logins return 503
  new_student_registration: boolean;   // allow students to self-register (if ever implemented)
  anomaly_detection_enabled: boolean;  // platform-wide toggle for the anomaly detection job
  max_file_upload_mb: number;          // platform-wide file size limit
  socket_io_enabled: boolean;          // emergency toggle if socket server has issues
  rate_limit_override: Record<string, number>; // per-route rate limit overrides
}
```

**Maintenance Mode**: flipping this to `true` immediately blocks all admin and student logins. SuperAdmin logins are unaffected. A banner is shown to anyone who tries to log in: "The platform is temporarily under maintenance. Please try again later." SuperAdmin can set a `maintenance_message` and `estimated_resume_time` to display in this banner.

**Feature flag changes are logged to audit trail** with before/after values. A flag change is never silent.

### Audit Log Viewer (Platform-Wide)
Route: `/system/audit`

Extends the admin's audit log view:
- Filter by college, actor, role (superadmin / admin), action type, date range.
- Full-text search on `action` and `entity_type`.
- Highlight SuperAdmin actions in purple (distinguishable from admin actions).
- Export: `GET /superadmin/audit?...&export=csv` — streams CSV directly (no async job needed for audit logs — it's a read operation).
- **Immutability notice**: displayed prominently — "Audit logs cannot be modified or deleted. All records are permanent."

### Database Index Monitor
Route: `/system/db-indexes`

Shows all MongoDB indexes across all collections with:
- Index name and key pattern
- Cardinality estimate (from `db.collection.stats()`)
- Usage stats (from `db.collection.aggregate([{ $indexStats: {} }])`)
- Last used timestamp

Flags:
- **Unused indexes** (not used in last 7 days): "Consider dropping this index to reduce write overhead."
- **Missing recommended indexes**: hardcoded list of expected indexes checked against actual. Red if missing.

This page is the answer to "why are queries slow in production" — the SuperAdmin can see at a glance if an index was accidentally dropped or never created in a deployment.

---

## IMPERSONATION SYSTEM

### Start Impersonation
```ts
// SuperAdmin clicks "Impersonate" on a user profile
POST /superadmin/impersonate/start { target_id: string; target_role: 'admin' | 'student' }

// Server response
{
  impersonation_token: string;     // short-lived (30 min), scoped to read-only
  session_id: string;              // for audit trail
  target: { id, name, role, college_id }
}
```

The `impersonation_token` is a specially crafted JWT that:
- Contains the target user's claims (`college_id`, `role`, `permissions`)
- Contains `impersonated_by: superadmin_id`
- Contains `impersonation_session_id`
- Has a `read_only: true` claim

The server middleware checks for `read_only: true` and blocks all non-GET requests:
```ts
export const blockImpersonationWrites = (req, res, next) => {
  if (req.user.read_only && req.method !== 'GET') {
    return res.status(403).json({ code: 'IMPERSONATION_WRITE_BLOCKED' });
  }
  next();
};
```

### During Impersonation
- The client uses the `impersonation_token` for all API calls (not the SuperAdmin's own token).
- The `X-Impersonation-Session` header is attached to every request (for server-side logging).
- Every API call is logged to `ImpersonationActivityLog`: `{ session_id, superadmin_id, target_id, method, path, timestamp }`.
- The amber impersonation banner is rendered in the target user's portal layout (since the SuperAdmin is seeing the target's portal, not the SuperAdmin portal).

### End Impersonation
- Clicking "Exit" in the impersonation banner.
- Token expiry (30 minutes).
- Server emits a `IMPERSONATION_ENDED` Socket.io event to the SuperAdmin's own room, in case they have another tab open.

### Edge Cases — Impersonation
- **Impersonating an admin who is in the middle of a test live-monitor**: the SuperAdmin sees the live monitor in read-only mode. All socket events from students still arrive (SuperAdmin is joining the same socket room as the admin). Write actions (force-submit, extend time) are blocked by the middleware.
- **Impersonation token expires while viewing student's test detail**: next API call returns 401. Show: "Your impersonation session has expired. Return to SuperAdmin." Navigate to the SuperAdmin portal.
- **SuperAdmin impersonates, then their own SuperAdmin session expires**: the `impersonation_token` is independent of the SuperAdmin's session token. They can still exit impersonation. The exit call uses the `impersonation_token` itself, not the SuperAdmin's token.
- **Impersonating a deactivated account**: block. "This account is deactivated. There is nothing to impersonate." An impersonation of a deactivated account would show permission errors everywhere — unhelpful and confusing.

---

## GLOBAL STATE ARCHITECTURE

### Redux Store Shape
```ts
store = {
  superauth: {
    superadmin: SuperAdminUser | null,
    token: string | null,
    session_id: string | null,
    mfa_verified: boolean,
    status: AuthStatus,
    active_sessions: SuperAdminSession[], // for session management page
  },
  impersonation: {
    active: boolean,
    token: string | null,
    session_id: string | null,
    target: ImpersonationTarget | null,
    started_at: string | null,
  },
  platform: {
    config: PlatformConfig,
    system_health: SystemHealth,
    health_last_checked: string,
    colleges: College[],            // all 5 colleges — loaded at app init
    fetched_at: string,
  },
  ui: {
    sidebarOpen: boolean,
    theme: 'light' | 'dark' | 'system',
    toasts: Toast[],
    alerts: PlatformAlert[],        // system health alerts
    globalSearch: GlobalSearchState,
    selectedCollege: string | null, // for pages that operate on a single college
  },
  notifications: {
    items: Notification[],
    unread_count: number,
  },
  liveMonitor: {
    platform_stats: PlatformLiveStats,
    violation_feed: ViolationEvent[],
    socket_status: SocketStatus,
  },
}
```

**React Query manages**: college data details, user lists, test lists, report data, audit logs, job queue status, system indexes.

**Redux manages**: auth, impersonation state, platform config, system health, college list (small, rarely changes), live feed.

### React Query Configuration (SuperAdmin-specific)
```ts
const superAdminQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // 1 minute — SuperAdmin sees fresher data than students
      gcTime: 300_000,              // 5 minutes
      retry: 3,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: true,
    },
  },
});

// Specific stale times
const collegeListQuery = { staleTime: 300_000 };         // rarely changes
const platformHealthQuery = { staleTime: 30_000 };       // check every 30s
const auditLogQuery = { staleTime: 0 };                  // always fresh
const jobQueueQuery = { staleTime: 5_000 };              // near real-time
const userListQuery = { staleTime: 60_000 };
```

---

## PERFORMANCE REQUIREMENTS

### Bundle Strategy
- SuperAdmin portal is a separate Vite entry point from the admin and student portals.
- They share component libraries (shadcn, utils) via a monorepo `packages/ui` workspace, but their app bundles are completely separate. A student loading the student portal never downloads SuperAdmin code.
- `vite.config.ts` has `rollupOptions.input` pointing to separate entry points per role.

### Data Volume Considerations
- Platform-wide user list: potentially 10,000 students across 5 colleges. Never fetch all at once. Always paginate: `GET /superadmin/students?page=1&limit=50`.
- Platform-wide audit logs: potentially millions of records. Paginate with cursor-based pagination (not offset — offset is slow on large collections): `GET /superadmin/audit?after_id={last_id}&limit=50`.
- Cross-college leaderboard: aggregated in the nightly job. Never computed on request.

### Cursor-Based Pagination for Audit Logs
```ts
// Server
const logs = await AuditLog
  .find({ ...(after_id ? { _id: { $lt: new ObjectId(after_id) } } : {}), ...scopeFilter })
  .sort({ _id: -1 })
  .limit(51);                         // fetch 51, use 50, the 51st signals "has more"

const hasMore = logs.length === 51;
return { logs: logs.slice(0, 50), next_cursor: hasMore ? logs[49]._id : null };
```

Client uses `useInfiniteQuery` from React Query for cursor-based pagination in the audit log viewer.

### Indexes Required for SuperAdmin Queries
```js
// Cross-college queries
Attempt.index({ status: 1, submitted_at: -1 })               // platform-wide submission feed
Attempt.index({ college_id: 1, test_id: 1, score: -1 })      // per-college leaderboard
User.index({ role: 1, college_id: 1, active: 1 })            // admin management
User.index({ role: 1, active: 1, last_login: 1 })            // inactive account detection

// Audit logs — most queried collection for SuperAdmin
AuditLog.index({ created_at: -1 })                           // default sort
AuditLog.index({ actor_id: 1, created_at: -1 })              // per-actor history
AuditLog.index({ college_id: 1, created_at: -1 })            // per-college audit
AuditLog.index({ entity_type: 1, entity_id: 1 })             // entity-specific history

// Platform analytics snapshot
PlatformAnalyticsSnapshot.index({ date: -1, college_id: 1 }) // report queries
PlatformAnalyticsSnapshot.index({ date: -1 })                // platform-wide trend

// System
Job.index({ status: 1, type: 1, created_at: -1 })
Job.index({ college_id: 1, status: 1, created_at: -1 })
```

---

## ERROR HANDLING MATRIX (SUPERADMIN-SPECIFIC)

| Scenario | Client Response | Server Code |
|---|---|---|
| MFA code wrong | Inline error, remaining attempts shown | 401 `TOTP_INVALID` |
| MFA locked (5 failures) | Show: "Start a new login attempt" | 429 `TOTP_LOCKED` |
| Deactivate admin with live test | Impact analysis modal, require confirmation | — (client enforced) |
| Set max_participants below current count | Block save, inline error | 400 `PARTICIPANTS_EXCEED_MAX` |
| Cross-college test conflict | Conflict review step, require acknowledgment | 200 `{ conflicts: [...] }` |
| Maintenance mode while SuperAdmin is using portal | No effect on SuperAdmin (middleware bypasses) | SuperAdmin bypass |
| Export all college data, job fails midway | Partial zip available, show retry with resume | 500 `{ partial_export_url }` |
| Platform health endpoint unreachable | Show "Health check unavailable" — not green | Client fetch error |
| Impersonate deactivated user | Block with clear message | 400 `TARGET_INACTIVE` |
| Typed acknowledgment wrong string | Inline validation error, no API call made | — (client enforced) |
| Session revoked by another SuperAdmin | 401 `SESSION_REVOKED` on next request | 401 + logout |

---

## TESTING FIXTURES

```ts
// SuperAdmin fixture
const superAdminFixture = {
  _id: 'sa_001', name: 'Platform Admin', email: 'platform@lms.io',
  role: 'superadmin', mfa_enabled: true, active: true,
  session_id: 'sess_xyz',
};

// Platform state fixtures
const platformFixtures = {
  all_healthy: {
    mongodb: { status: 'ok', avg_response_ms: 12 },
    redis: { status: 'ok', hit_rate: 0.94 },
    job_queue: { pending: 2, failed_last_hour: 0 },
    socket_server: { connected_clients: 342 },
  },
  degraded_db: {
    mongodb: { status: 'degraded', avg_response_ms: 4200 },
    redis: { status: 'ok', hit_rate: 0.60 }, // lower hit rate — more DB misses
    job_queue: { pending: 47, failed_last_hour: 12 }, // jobs failing due to slow DB
  },
  maintenance_mode: { config: { maintenance_mode: true } },
};

// College fixtures
const collegeFixtures = {
  active: { _id: 'col_a', name: 'College A', status: 'active', student_count: 1200 },
  suspended: { _id: 'col_b', name: 'College B', status: 'suspended' },
  at_admin_limit: { _id: 'col_c', max_admins: 5, admin_count: 5 },
};

// Cross-college test fixtures
const crossCollegeTestFixtures = {
  scheduled_two_colleges: {
    scope: 'cross_college',
    college_assignments: [
      { college_id: 'col_a', status: 'scheduled', start_date: future(2) },
      { college_id: 'col_b', status: 'scheduled', start_date: future(3) },
    ]
  },
  mixed_live: {
    college_assignments: [
      { college_id: 'col_a', status: 'live' },    // edit blocked
      { college_id: 'col_b', status: 'scheduled' }, // edit allowed
    ]
  },
  conflict_detected: {
    college_assignments: [{ college_id: 'col_a', start_date: future(1), end_date: future(3) }],
    conflicts: [{ college_id: 'col_a', conflicting_test: 'Mid-Term OS', overlap: '2 hours' }]
  },
};

// Impersonation fixtures
const impersonationFixtures = {
  impersonating_admin: {
    active: true, target: { id: 'adm_001', role: 'admin', college_id: 'col_a' },
    token: mockImpersonationToken, session_id: 'imp_sess_001',
  },
  impersonating_student: {
    active: true, target: { id: 'stu_001', role: 'student', college_id: 'col_a' },
  },
  expired_impersonation: {
    active: false, token: null, session_id: null,
    expiry_reason: 'token_expired',
  },
};

// Announcement scope fixtures
const announcementFixtures = {
  all_students: { scope: { type: 'all_colleges', role: 'student' }, recipient_count: 5420 },
  specific_college: { scope: { type: 'specific_colleges', college_ids: ['col_a'] }, recipient_count: 1200 },
  zero_recipients: { scope: { type: 'specific_departments', department_filters: [{ college_id: 'col_a', departments: ['NONEXISTENT'] }] }, recipient_count: 0 },
  admin_only: { scope: { type: 'role', role: 'admin' }, recipient_count: 18 },
};

// Expected outcomes
const expectations = {
  'maintenance mode on': { admin_login_blocked: true, student_login_blocked: true, superadmin_unaffected: true },
  'impersonation write attempt': { blocked: true, code: 'IMPERSONATION_WRITE_BLOCKED' },
  'deactivate admin with live tests': { impact_modal_shown: true, tests_unaffected: true },
  'cross-college test edit on mixed-live': { col_a_edits_blocked: true, col_b_edits_allowed: true },
  'announcement to 0 recipients': { send_blocked: true, error: 'No users match this scope' },
  'typed acknowledgment wrong': { api_call_not_made: true, inline_error_shown: true },
};
```

---

## FUTUREPROOFING DECISIONS

### Multi-SuperAdmin Collaboration
When two SuperAdmins are both online, they may conflict on platform config changes. Add a `config_version` field to `PlatformConfig` (optimistic locking). On save, include the version the client read. If the server's current version is higher, return 409 `CONCURRENT_EDIT`. The second SuperAdmin's UI shows the current values and asks them to re-apply their changes.

### Role Expansion (future: "CollegeOwner" role)
The permission architecture is additive. Adding a new role between SuperAdmin and Admin requires: new JWT role value, new middleware guard, new sidebar/shell variant. The pattern is already established — adding a role is a named, bounded change, not a cross-cutting refactor.

### Webhooks (v2)
When `api_webhooks: true` is enabled for a college, the platform POSTs structured payloads to the college's registered endpoint on: test completion, bulk import completion, student deactivation. The webhook delivery is a Bull job — retried 3 times with exponential backoff. The SuperAdmin's job monitor shows webhook delivery status.

### GDPR / Data Retention Policies (v2)
Add a `data_retention_policy` to `PlatformConfig`:
```ts
{
  attempt_records_retain_years: 5,
  audit_logs_retain_years: 7,
  deleted_user_anonymize_after_days: 30,
}
```
A nightly cron job anonymises deleted user records after the configured period (replace name/email with hashed values, preserve scores for aggregate statistics). SuperAdmin UI shows which records are scheduled for anonymisation.

### SSO / SAML Integration (v3)
The auth middleware already isolates the token verification logic behind an `IAuthProvider` interface. In v3, implementing SAML SSO means writing a new `SAMLAuthProvider` and injecting it — no changes to the middleware stack, no changes to route handlers. The architecture supports this from day one because auth is never hardcoded to local JWT.

### Distributed Tracing (v2)
Every API request should carry a `X-Request-ID` header (generated client-side as `uuidv4()` if not present, passed through to all downstream services). Log this ID on every server log line. When a SuperAdmin reports "the report export failed at 3 PM," the support team can grep logs for `X-Request-ID` and see the full chain of events. The header infrastructure should be built now, even if distributed tracing (Jaeger/Zipkin) is added later.
