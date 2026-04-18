# Admin Portal — Full System Design Prompt
### LMS Portal · MERN + Tailwind + shadcn + Redux Toolkit · JWT Auth
### Multi-College Architecture · 5 Institutions · Production-Grade

---

## ROLE & CONTEXT

You are building the **Admin Portal** of a multi-college LMS used across 5 universities. Each admin belongs to exactly one college. They can only see, create, and modify data within their college's scope. This isolation is enforced at the database query level — not just the UI level. The stack is React (Vite), Tailwind CSS, shadcn/ui, Redux Toolkit, React Router v6, React Query (TanStack Query v5), Socket.io client, and a Node/Express/MongoDB backend.

The admin portal is a **power-user application**, not a consumer app. Prioritise data density, keyboard navigation, bulk operations, and error recovery over visual flourish. Every action the admin takes must be auditable, recoverable where possible, and safe by default.

---

## CORE ARCHITECTURAL PRINCIPLES

### Principle 1 — College Scope is Inviolable
Every API call the admin makes is automatically scoped to their `college_id` on the server, derived from the JWT. The client never sends `college_id` in the body or query params for scoped operations. The server reads it from the token. This means:
- Forging a request with another college's ID returns 403, not that college's data
- The admin UI never renders a college selector (unlike SuperAdmin)
- All Mongoose queries in admin controllers use `{ ...req.collegeFilter }` spread from middleware

### Principle 2 — Test State Machine is Append-Only After Live
Tests transition through states: `draft → scheduled → live → completed → archived`. Once `live`, the test document is partially immutable. Once `completed`, fully immutable. Architecture decisions must respect this — the UI must prevent illegal state transitions, and the server must reject them as a second line of defence.

### Principle 3 — Wizard State Lives in Redux, Not Component State
The 6-step test creation wizard can take 30–60 minutes to complete. If the admin navigates away, refreshes, or loses connection, they must be able to resume exactly where they left off. Wizard state is persisted in Redux and synced to the server as a `draft` document every 30 seconds and on every step completion.

### Principle 4 — Bulk Operations Need Explicit Confirmation and Rollback
Any operation affecting multiple students or tests requires a two-phase commit pattern: preview what will change, confirm with an explicit acknowledgment, execute, and report results per-item. Never run bulk operations silently.

### Principle 5 — Audit Everything
Every write operation (create, update, delete, publish) is intercepted by a Redux middleware that dispatches an audit log entry to the server. The audit log is the admin's undo trail. It is also the evidence trail for college administrators and superadmins.

---

## AUTHENTICATION & PERMISSION SYSTEM

### JWT Payload for Admin
```ts
interface AdminJWTPayload {
  sub: string;             // admin user _id
  role: 'admin';
  college_id: string;      // immutable — set at account creation
  permissions: Permission[];
  iat: number;
  exp: number;             // 15 minute access token
}

type Permission =
  | 'create_test'
  | 'edit_test'
  | 'delete_test'
  | 'publish_test'
  | 'manage_questions'
  | 'manage_batches'
  | 'manage_events'
  | 'view_reports'
  | 'export_reports'
  | 'manage_students'
  | 'bulk_import';
```

### Permission Guard — Client
```ts
// Hook used throughout the admin portal
const usePermission = (permission: Permission): boolean => {
  const permissions = useSelector(selectAdminPermissions);
  return permissions.includes(permission);
};

// Usage in components
const canCreateTest = usePermission('create_test');
if (!canCreateTest) return <PermissionDenied action="create tests" />;
```

### Permission Guard — Server Middleware
```ts
export const requirePermission = (...perms: Permission[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const has = perms.every(p => req.user.permissions.includes(p));
    if (!has) return res.status(403).json({ code: 'INSUFFICIENT_PERMISSIONS', required: perms });
    next();
  };

// Route definition
router.post('/tests',
  verifyJWT,
  requireCollegeScope,      // attaches req.collegeFilter
  requirePermission('create_test', 'manage_questions'),
  auditLogger('TEST_CREATE'),
  TestController.create
);
```

### Edge Cases — Auth
- **Permission downgrade while logged in**: SuperAdmin removes `create_test` from an admin who has the wizard open. The admin's current token still has the old permissions for up to 15 minutes. The server rejects the save on the next API call. Client receives 403 — show: "Your permissions have changed. You can no longer perform this action." Refresh the token silently to pull the new permissions.
- **Admin logs into two browser windows**: treat this as valid. Both windows share the same session. Changes in one window should be detectable in the other via polling or WebSocket events (broadcast `admin_data_changed` events via Socket.io to the admin's room, identified by `admin_id`).
- **Session expiry during long wizard fill**: the 15-minute access token expires while the admin is typing question #47. The Axios interceptor refreshes silently. The wizard continues with no visible interruption. The refresh token (7 days, httpOnly cookie) handles this.

---

## ADMIN LAYOUT ARCHITECTURE

### Shell Structure
```
AdminShell
├── TopBar (fixed)
│   ├── College name + logo
│   ├── Global search (Cmd+K)
│   ├── Notification bell
│   ├── Quick actions menu
│   └── Admin avatar + dropdown
├── Sidebar (collapsible, 260px / 64px icon-only)
│   ├── Dashboard
│   ├── Tests (with sub-nav: All Tests, Create New, Question Bank)
│   ├── Batches
│   ├── Events
│   ├── Reports
│   ├── Students
│   └── Settings
└── Main content area (<Outlet />)
    ├── Page header (title + breadcrumb + page-level actions)
    └── Page body
```

### Global Search (Cmd+K)
- Opens a command palette modal (shadcn `<CommandDialog />`).
- Searches across: tests by name, students by name/roll number, batches by name, events by name.
- Results are fetched from `GET /admin/search?q={query}&college_id={from_jwt}` with debounce 300ms.
- Recent searches stored in `localStorage` (max 10). Shown before typing.
- Keyboard navigation: arrow keys to move, Enter to navigate, Escape to close.
- Edge case: admin types 1 character — don't fetch. Minimum query length is 2 characters.
- Edge case: search returns 0 results — show empty state with suggestion: "Try searching by roll number for students."

### Notification System (Admin-specific)
Admin notifications differ from student notifications:
- `STUDENT_BULK_IMPORT_COMPLETE` — with success/failure count
- `TEST_ATTEMPT_ANOMALY` — unusual pattern detected (e.g. identical answers between two students)
- `REPORT_EXPORT_READY` — async PDF generation complete
- `BATCH_ASSIGNED` — confirmation of batch-test assignment
- `EVENT_FULL` — event at capacity

Notifications arrive via Socket.io push (no polling needed since the socket connection is already open for real-time test monitoring). Store in Redux, badge count in `ui.adminNotifications.unread_count`.

---

## DASHBOARD PAGE

### KPI Cards (top row)
- Active tests right now (tests in `live` state)
- Tests scheduled this week
- Students who have taken at least one test this month (unique `student_id` count in `Attempts`)
- Average score across all tests this month

### Data Freshness
- KPI cards: `staleTime: 300_000` (5 minutes). Refetch on window focus.
- "Active tests right now" counter: real-time via Socket.io event `test_status_change`. Server emits to the admin's room when any of their tests transitions to `live` or `completed`.

### Recent Activity Feed
- Last 10 audit log entries for this admin's college: "Admin Ravi created test 'Unit 3 - OS'" 10 minutes ago.
- Pulled from `GET /audit-logs?college_id={jwt}&limit=10`.
- Clicking an entry navigates to the relevant entity.

### Performance
- Dashboard data is split into multiple React Query calls, not one monolithic fetch. KPI data, recent tests, and activity feed load independently. A slow report query doesn't block the KPI cards from rendering.
- Skeleton loaders for all four KPI cards simultaneously. Never show partial data with a spinner where a number should be.

---

## TEST MANAGEMENT — ALL TESTS PAGE

### List View
- Filterable by: status (draft/scheduled/live/completed/archived), department, batch, date range, created by (if admin has sub-admins).
- Sortable columns: name, created date, start date, student count, avg score.
- Columns: Test Name | Status badge | Target (dept/batch) | Date Range | Attempts | Avg Score | Actions.
- Action menu per row: View, Edit (if status allows), Duplicate, Archive, Delete.

### Status Badges with Semantic Meaning
```
draft       → gray badge       → "Fill in questions to schedule"
scheduled   → blue badge       → "Starts in Xd Xh"
live        → green pulse badge → "X students active now"
completed   → teal badge       → "X submissions"
archived    → gray muted badge → "Soft deleted"
```

The `live` badge has a subtle CSS pulse animation to signal real-time activity. Click it to open a Live Monitor drawer (see Test Live Monitoring section).

### Duplicate Test
- `POST /tests/:id/duplicate` — server creates a new test document with all metadata and questions copied, status forced to `draft`, name appended with " (Copy)".
- The duplicate includes: all questions, proctoring config, time settings.
- The duplicate does NOT include: batch/department assignments, attempt records, date ranges (set to null — admin must configure before publishing).
- Use case: admin runs the same test each semester. They duplicate, adjust dates, reassign batches.

### Archive vs Delete
- Archive (`PATCH /tests/:id/archive`): soft delete. Status becomes `archived`. Attempt records preserved. Test no longer visible to students. Admin can un-archive. Default for any test with existing attempt records.
- Delete (`DELETE /tests/:id`): hard delete. Only allowed for `draft` tests with zero attempt records. Shows confirmation dialog: "This test has no submissions. Permanently delete?" Requires typing the test name to confirm.
- Edge case: admin tries to delete a `draft` test that has zero attempts but is currently being previewed by another admin tab. Server acquires a short-lived lock (5s, Redis `SET NX`). If locked, return 409 with "This test is being accessed. Try again in a moment."

### Bulk Actions
- Select multiple tests via checkboxes. Bulk actions: Archive selected, Delete selected (drafts only — server silently skips non-drafts and reports which were skipped), Export results.
- Confirmation modal for bulk delete: "You are about to delete 4 tests. 2 are eligible (draft, no submissions). 2 will be skipped (have submissions). Proceed?"

---

## TEST CREATION WIZARD — DEEP ARCHITECTURE

### Wizard Redux Slice
```ts
interface WizardState {
  wizard_id: string;               // UUID generated client-side on wizard open
  server_draft_id: string | null;  // MongoDB _id once first save succeeds
  current_step: 1 | 2 | 3 | 4 | 5 | 6;
  step_validity: Record<1|2|3|4|5|6, boolean>;
  last_saved_at: string | null;
  save_status: 'idle' | 'saving' | 'saved' | 'error';
  is_dirty: boolean;               // unsaved changes since last save

  // Step 1: Metadata
  metadata: {
    test_name: string;
    description: string;
    max_attempts: number;
    time_limit_minutes: number;
    shuffle_questions: boolean;
    shuffle_options: boolean;
    result_visibility: 'show_all' | 'show_score_only' | 'show_after_deadline';
    negative_marking_enabled: boolean;
    default_negative_marks: number;
  };

  // Step 2: Schedule & Assignment
  schedule: {
    start_date: string | null;       // ISO UTC
    end_date: string | null;         // ISO UTC
    timezone_label: string;          // display only — stored as UTC
    assigned_departments: string[];
    assigned_batch_ids: string[];
    is_upcoming: boolean;            // show in student upcoming before start
  };

  // Step 3: Questions
  questions: WizardQuestion[];
  question_upload_errors: UploadError[];
  total_marks: number;               // computed from questions

  // Step 4: Review (read-only, computed from steps 1-3)

  // Step 5: Proctoring
  proctoring: ProctoringConfig;

  // Step 6: Publish
  publish_intent: 'draft' | 'upcoming' | 'live_immediately';
}
```

### Wizard Auto-Save
```ts
// Redux middleware — runs after every wizard action
const wizardAutoSaveMiddleware: Middleware = store => next => action => {
  const result = next(action);

  if (!action.type.startsWith('wizard/')) return result;

  const state = store.getState().wizard;
  if (!state.is_dirty) return result;

  // Debounce: clear any pending save, schedule new one in 30s
  clearTimeout(wizardSaveTimer);
  wizardSaveTimer = setTimeout(() => {
    store.dispatch(wizardActions.saveToServer());
  }, 30_000);

  // Also save immediately on step completion
  if (action.type === 'wizard/completeStep') {
    clearTimeout(wizardSaveTimer);
    store.dispatch(wizardActions.saveToServer());
  }

  return result;
};
```

**Save endpoint**: `PUT /tests/draft/:wizard_id` — upsert pattern. First call creates the draft document with `wizard_id` as idempotency key. Subsequent calls update it. Server returns the MongoDB `_id` on first creation — stored in `server_draft_id`. This prevents duplicate documents on network retry.

**Resume draft on page load**: On admin navigating to `/tests/create`, check `GET /tests/draft/mine?status=draft` — returns any in-progress drafts. If found, show: "You have an unfinished test: [name]. Resume or Start Fresh?" Starting fresh does NOT delete the draft — it archives it in case the admin changes their mind. Deleting drafts is explicit.

---

### STEP 1 — TEST METADATA

#### Fields & Validation
```ts
const metadataSchema = z.object({
  test_name: z.string().min(3, 'Min 3 characters').max(120, 'Max 120 characters'),
  description: z.string().max(500).optional(),
  max_attempts: z.number().int().min(1).max(10),
  time_limit_minutes: z.number().int().min(5).max(480),
  shuffle_questions: z.boolean(),
  shuffle_options: z.boolean(),
  result_visibility: z.enum(['show_all', 'show_score_only', 'show_after_deadline']),
  negative_marking_enabled: z.boolean(),
  default_negative_marks: z.number().min(0).max(5).multipleOf(0.25),
});
```

**Validation strategy**: Use `react-hook-form` with `zodResolver`. Validate on blur for individual fields, on submit for the full step. Show inline errors immediately on blur — never wait for the user to click "Next" before showing that the test name is too short.

**UX rules**:
- `negative_marking_enabled: false` → grey out `default_negative_marks` field visually (disabled, not hidden).
- `result_visibility: 'show_after_deadline'` → show an info tooltip: "Students see full results only after the test end date passes."
- `max_attempts > 1` → show info: "Only the last attempt score is considered in reports and leaderboard."
- Character counter on `test_name` field: "47 / 120".

**Edge Cases — Step 1**
- Admin sets `time_limit_minutes: 480` (8 hours) with `max_attempts: 3`: server accepts but warn in UI — "A 3x 8-hour test may run over multiple days. Ensure your date range accounts for this."
- Duplicate test name within same college: check via `GET /tests/check-name?name={}&college_id={jwt}` (debounced 500ms). Show warning (not error) — duplicates are allowed but flagged: "Another test has this name. Students may find this confusing."
- `shuffle_options: true` for True/False questions: the system should silently ignore option shuffling for T/F questions at render time. Flag this in the Step 4 review.

---

### STEP 2 — SCHEDULE & ASSIGNMENT

#### Date Range Picker
- Use `react-day-picker` or shadcn's date picker.
- `start_date` minimum: today at current time (no past dates). Use server time from `GET /server-time` on mount — don't trust client clock for minimum date validation.
- `end_date` minimum: `start_date + time_limit_minutes` (the test must have at least one full run window).
- Both dates stored as UTC ISO strings. Display in the admin's local timezone with timezone label.
- Warn if `end_date - start_date < time_limit_minutes * 3`: "Short window. Students may not have enough time for multiple attempts."

#### Department & Batch Assignment
```ts
// Multi-select with search, shows checkboxes
<DepartmentBatchAssignment
  departments={college.departments}        // from Redux, loaded at app init
  batches={batches}                        // from React Query
  selectedDepts={schedule.assigned_departments}
  selectedBatches={schedule.assigned_batch_ids}
  onChange={dispatch}
  preview={<StudentCountPreview />}
/>
```

`<StudentCountPreview />` — real-time count of students who will receive this test: `GET /students/count?departments={}&batch_ids={}&college_id={jwt}`. Debounced 500ms. Shows: "142 students across 3 departments will see this test."

**Edge Cases — Step 2**
- Admin selects Batch A and Department CSE, but all Batch A students are already in CSE: warn "Batch A students are already included under the CSE department selection. No additional students are added by selecting the batch." Still allow it — admin may be intentional.
- Admin deselects all departments and all batches: show blocking validation error: "At least one department or batch must be selected."
- Admin sets `start_date` to 3 years in the future: allow it, warn: "This test starts 1,095 days from now. Are you sure?"
- Admin sets a 10-minute test with a 2-week window and 3 attempts: perfectly valid. No warning needed.
- Edit mode (existing test): if the test is `scheduled`, admin may change date range forward only. Cannot move `start_date` earlier than now. Cannot move `end_date` before any existing attempt's `started_at`. Server enforces; client pre-validates.

---

### STEP 3 — QUESTION MANAGEMENT

This is the most complex and performance-sensitive step.

#### Question Data Model
```ts
interface WizardQuestion {
  // Client-side fields (not persisted as-is)
  client_id: string;              // UUID, stable across reorders
  order_index: number;            // 0-indexed, set by drag position

  // Persisted fields
  type: 'mcq_single' | 'mcq_multi' | 'true_false' | 'fill_blank' | 'paragraph';
  body: string;                   // HTML from rich text editor (DOMPurify sanitized before save)
  body_plain: string;             // Strip HTML — used for search, hashing, duplicate detection
  options: QuestionOption[];      // Empty for paragraph/fill_blank
  correct_answers: string[];      // option IDs for MCQ; 'true'/'false' for T/F; answer text for FIB
  marks: number;
  negative_marks: number;         // override of test-level default
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;                  // free text tag
  explanation: string;            // shown to student in result review (optional)
  auto_advance: boolean;          // auto-move to next question on answer (only MCQ single & T/F)
  fib_case_sensitive: boolean;    // only for fill_blank type
  fib_accepted_variations: string[]; // list of acceptable FIB answers

  // Computed / metadata
  _hash: string;                  // SHA-256 of body_plain + correct_answers — used for duplicate detection
  source: 'manual' | 'bulk_upload';
  has_error: boolean;             // from validation run
  error_messages: string[];
}
```

#### Rich Text Editor for Question Body
Use **TipTap** (not Quill — better React integration, better TypeScript support). Extensions required:
- `StarterKit` (bold, italic, lists, code)
- `Mathematics` (via TipTap + KaTeX for math notation: `$E = mc^2$`)
- `Image` (inline images in questions — upload to S3 via `POST /uploads/question-image`, returns URL)
- `Table` (for data table questions)
- Custom extension: `CodeBlock` with syntax highlighting for programming questions

**Sanitization**: Before dispatching to Redux and before saving to the server, run the HTML through `DOMPurify.sanitize(html, { ADD_TAGS: ['math', 'mi', 'mn'], ADD_ATTR: ['class'] })`. The `class` attribute is needed for KaTeX rendering.

**Performance — Rich Text**:
- Never store the TipTap editor instance in Redux. Store only the HTML string.
- If there are 100 questions, mounting 100 TipTap instances at once is catastrophic. Use a single shared editor instance: only the currently-editing question has a live editor. Others display rendered HTML (`dangerouslySetInnerHTML` with sanitized content).
- Virtual list for the question palette (left column): use `@tanstack/react-virtual` for the question list once > 30 questions. Only render ~5 questions in the DOM at any time.

#### Manual Question Entry UX
Layout: split panel — question list (left, 280px) + question editor (right, fills remaining space).

Question list shows: question number, first 60 chars of body_plain, type icon, difficulty badge, marks, error indicator (red dot).

Adding a question:
1. Click "+ Add Question" → shows a type selector (MCQ Single / MCQ Multi / True/False / Fill in the Blank / Paragraph).
2. Selected type initialises a blank `WizardQuestion` with `client_id: uuidv4()` and `order_index: questions.length`.
3. Question editor opens on the right.
4. Admin fills in body, options, correct answer, marks, topic, difficulty.
5. On blur of any field: validate that question + dispatch to `wizard/updateQuestion`.

MCQ option management:
- "Add Option" button adds a new option. Minimum 2 options, maximum 6.
- "Delete Option" — if the deleted option was the correct answer, clear the correct answer selection and show an error: "The correct answer was removed. Please select a new one."
- For MCQ Multi: multiple options can be marked correct. Show checkboxes, not radio buttons.
- Option order is shuffleable by the admin during creation (drag handles). This is the canonical order — shuffling for students is a separate randomisation at attempt-creation time.

Reordering questions:
- Drag-and-drop using `@dnd-kit/core` (not `react-beautiful-dnd` — it's unmaintained).
- On drop: recompute `order_index` for all questions. Dispatch a batch update.
- Reordering does NOT trigger an auto-save. It sets `is_dirty: true`. The 30s timer handles the save.

#### Bulk JSON Upload
```json
[
  {
    "type": "mcq_single",
    "body": "<p>What is the output of <code>print(type([]))</code>?</p>",
    "options": [
      { "text": "<class 'list'>" },
      { "text": "<class 'tuple'>" },
      { "text": "<class 'dict'>" },
      { "text": "None" }
    ],
    "correct_index": 0,
    "marks": 2,
    "negative_marks": 0.5,
    "difficulty": "easy",
    "topic": "Python Basics",
    "explanation": "The type() function returns the data type."
  }
]
```

**Upload pipeline** (client-side, before any server call):
```ts
const validateBulkUpload = (raw: unknown[]): ValidationResult => {
  const results = raw.map((item, index) => {
    const parsed = BulkQuestionSchema.safeParse(item);
    if (!parsed.success) {
      return { row: index + 1, valid: false, errors: parsed.error.issues.map(i => i.message) };
    }
    const q = parsed.data;
    // Content validation beyond schema
    if (q.type === 'mcq_single' && q.correct_index >= q.options.length) {
      return { row: index + 1, valid: false, errors: ['correct_index out of bounds'] };
    }
    if (q.type === 'mcq_multi' && q.correct_indices.length === 0) {
      return { row: index + 1, valid: false, errors: ['At least one correct answer required'] };
    }
    if (q.marks <= 0) {
      return { row: index + 1, valid: false, errors: ['marks must be positive'] };
    }
    // Duplicate detection within the upload
    const hash = sha256(q.body + JSON.stringify(q.correct_index ?? q.correct_indices));
    return { row: index + 1, valid: true, hash, data: q };
  });

  // Cross-row duplicate detection
  const hashMap = new Map<string, number>();
  results.forEach(r => {
    if (r.valid && r.hash) {
      if (hashMap.has(r.hash)) {
        r.valid = false;
        r.errors = [`Duplicate of row ${hashMap.get(r.hash)}`];
      } else {
        hashMap.set(r.hash, r.row);
      }
    }
  });

  return results;
};
```

Show a **preview table** after validation:
- Valid rows: green row, summary of question (type, marks, topic).
- Invalid rows: red row with error message inline.
- "Import X of Y questions (Z failed)" — admin can choose to import valid ones only, or fix and re-upload.
- If > 200 questions in the upload, virtualize the preview table.

Also cross-check against **existing questions in this test**: flag if an uploaded question is a duplicate of one already entered manually.

After admin confirms import: `POST /tests/draft/:wizard_id/questions/bulk` — server validates again (defence in depth), returns the same structured error report. Client applies the server's result, not its own optimistic data.

**Edge Cases — Questions**
- Admin uploads a JSON file that is valid JSON but an object, not an array: show "Expected an array of questions. Got an object."
- Admin uploads a 50MB JSON file: validate file size client-side before parsing (max 5MB). "File too large. Max 5MB."
- Question body contains `<script>` tags (XSS attempt): DOMPurify strips it silently before save. Log the event for audit.
- Admin adds 500 questions but the test has a 30-minute time limit: warn in Step 4 review: "At 500 questions and 30 minutes, each question gets 3.6 seconds. Consider reducing questions or increasing time."
- Admin enters a FIB question and sets `correct_answer` to empty string: validation error — "Correct answer cannot be empty."
- MCQ option text is empty string: validation error — "Option text cannot be empty."

---

### STEP 4 — REVIEW & EDIT

This step is **read-only by default** with inline edit affordances.

#### Computed Summary Panel
```ts
const summary = {
  total_questions: questions.length,
  total_marks: sum(questions.map(q => q.marks)),
  by_type: countBy(questions, 'type'),
  by_difficulty: countBy(questions, 'difficulty'),
  by_topic: groupBy(questions, 'topic'),
  avg_marks_per_question: total_marks / total_questions,
  estimated_seconds_per_question: (time_limit_minutes * 60) / total_questions,
  has_tf_with_shuffle: questions.some(q => q.type === 'true_false') && shuffle_options,
  questions_with_errors: questions.filter(q => q.has_error),
};
```

**Blocking issues** (admin cannot proceed to Step 5):
- `questions.length === 0`: "Add at least one question."
- `questions_with_errors.length > 0`: "Fix X questions with errors before continuing." List the question numbers.
- `total_marks === 0`: "Total marks cannot be 0."

**Non-blocking warnings** (shown but don't block):
- `has_tf_with_shuffle`: "Shuffle options is enabled but True/False questions won't have their options shuffled."
- `estimated_seconds_per_question < 30`: "Less than 30 seconds per question — may be too tight."
- Any question with `marks === 0`: "Questions 4, 7, 22 have 0 marks. Is this intentional?"
- Questions with no `topic` tag: "12 questions have no topic tag. Reports won't show topic-wise analysis for these."

Inline edit: clicking any question row opens a compact edit drawer (not the full question editor) for quick fixes — change marks, difficulty, topic, correct answer.

---

### STEP 5 — PROCTORING CONFIGURATION

#### Config Model
```ts
interface ProctoringConfig {
  fullscreen_required: boolean;
  tab_switch: {
    monitored: boolean;
    allowed: boolean;
    violation_weight: number;    // how much each violation counts toward threshold (default: 1)
  };
  copy_paste: {
    monitored: boolean;
    allowed: boolean;
    violation_weight: number;
  };
  window_blur: {
    monitored: boolean;
    allowed: boolean;
    violation_weight: number;
  };
  screenshot_detection: {
    enabled: boolean;
    violation_weight: number;
  };
  right_click_disabled: boolean;
  devtools_detection: boolean;    // detect F12 / inspect element
  total_violation_threshold: number;   // weighted sum before auto-submit
  show_violation_count_to_student: boolean; // whether student sees their violation counter
  warning_at_remaining_violations: number; // show warning when this many violations left
}
```

**Preset system**: Three presets to reduce admin friction:
- **Strict exam**: fullscreen required, all monitoring on, threshold 1.
- **Standard test**: fullscreen required, tab monitoring on, copy monitoring on, threshold 3.
- **Open assignment**: nothing monitored, no fullscreen, threshold 10 (effectively unlimited).

Admin can start from a preset and customise. Show a diff summary when they deviate from a preset: "You've changed 2 settings from the Standard Test preset."

**Edge Cases — Proctoring**
- `devtools_detection: true` on a programming/coding question type: this is contradictory (students may need devtools). Show warning: "DevTools detection is enabled, but this test contains code questions. Students using browser devtools to test code will be flagged."
- `total_violation_threshold: 0`: blocking validation error — "Threshold of 0 would auto-submit the test immediately. Minimum is 1."
- Admin enables all monitoring but sets threshold to 100: show warning — "A threshold of 100 with all violation types enabled may never trigger auto-submit. Is this intentional?"

---

### STEP 6 — PUBLISH

Three publish intents:
1. **Save as Draft**: test is created/updated with `status: draft`. Not visible to anyone.
2. **Schedule as Upcoming**: `status: scheduled`. Visible to target students in Upcoming Tests (locked CTA until `start_date`).
3. **Publish Live Immediately**: only allowed if `now >= start_date`. Skips scheduled state, goes directly to `live`.

**Pre-publish checklist** (server validates all of these; UI shows them as a visual checklist):
```
✓ Test name set
✓ Date range set and in the future
✓ At least one department or batch assigned
✓ At least one question added
✓ No questions with errors
✓ Proctoring configured
✓ Total marks > 0
```

**Publish confirmation**: "Publishing this test will make it visible to 142 students. You will not be able to edit questions after publishing. Proceed?"

**Post-publish**: navigate to the test detail page. Show a success banner: "Test published. Students in CSE and ECE departments can see it now." If published as upcoming, show a countdown: "Goes live in 2d 4h 30m."

**Edge Cases — Publish**
- Admin publishes, then immediately tries to edit a question: the edit button is disabled, tooltip: "Questions cannot be edited after publishing. Archive and duplicate this test to make changes."
- Admin's connection drops at the exact moment of publish API call: the server processes the request (201) but the client never receives the response. Next time the client polls `GET /tests/draft/:wizard_id`, it sees `status: scheduled` — show: "Good news — your test was published successfully before the connection dropped." Clear the wizard state.
- Two admin sessions publish the same draft simultaneously (two browser tabs): server uses optimistic locking on the draft document (`__v` mongoose version key). Second publish returns 409 `{ code: 'CONCURRENT_EDIT', current_version: 5 }`. Client shows: "This test was already published in another tab."

---

## TEST LIVE MONITORING

When a test is `live`, the admin has access to a real-time monitoring panel.

### Architecture
Socket.io room per test: `test_{test_id}`. Students emit heartbeats and violation events to this room. Admin joins the room and receives updates.

```
Student side: socket.emit('heartbeat', { attempt_id, answered: 7, total: 20 })
Admin side: socket.on('student_status_update', ({ student_id, answered, violations, ... }) => ...)
```

### Monitoring Panel UI
- **Active students table**: name, department, questions answered / total, time remaining, violation count, connection status (green/yellow/red dot).
- **Violation stream**: real-time feed of violations as they happen — "Priya Rajan — Tab Switch — 10:42:31 AM".
- **Force-submit controls**: admin can force-submit a specific student's attempt (with mandatory reason field). Confirmation required. Logged to audit trail.
- **Extend time**: `PATCH /attempts/:id/extend { extra_minutes }` — adds time to a specific student's `server_end_time`. Use case: student had a genuine network issue. Logged to audit trail.

### Performance — Live Monitoring
- Don't poll. Everything is WebSocket-pushed.
- If the WebSocket disconnects, fall back to polling `GET /tests/:id/active-attempts` every 30s and show a "Reconnecting..." banner.
- Virtualize the student table if > 50 active students. Sort by violation count descending by default (highest-risk students at top).

---

## BATCH MANAGEMENT

### Batch Model
```ts
interface Batch {
  _id: string;
  name: string;                   // "2024-CSE-A"
  college_id: string;             // from admin's JWT
  department: string;             // optional — a batch can span departments
  academic_year: string;          // "2024-2025"
  student_ids: string[];          // ObjectId references
  student_count: number;          // denormalized, updated on add/remove
  created_by: string;             // admin_id
  created_at: string;
  is_archived: boolean;
}
```

### Create Batch
- Form: name, department (optional), academic year.
- After creation: add students via search (by name or roll number) or bulk upload (CSV: one roll_number per line).
- CSV upload for students: `POST /batches/:id/students/bulk` — server matches roll numbers to student accounts within the admin's college, returns: added count, not found (roll numbers that don't match any student), already in batch.
- Show preview: "34 students matched. 2 not found: [21CS099, 21CS100]. 5 already in this batch."

### Assign Test to Batch
- From batch detail page OR from test creation wizard Step 2.
- `POST /tests/:id/assign-batch { batch_id }` — idempotent.
- If the batch contains students who already have the test via department assignment: server deduplicates. Client shows preview count (same `GET /students/count` endpoint from Step 2).

### Edge Cases — Batches
- Admin adds a student to a batch, but that student has already started an active attempt for a test now assigned to the batch: the student's existing attempt is unaffected. They won't get a second attempt just because they were added to the batch.
- Admin removes a student from a batch that has an ongoing test: `PATCH /batches/:id/students/remove { student_id }`. If the student has an in-progress attempt for any batch-assigned test, show warning: "This student has an active attempt for [Test Name]. Removing them from the batch will not cancel their current attempt." Proceed only with explicit confirmation.
- Batch name collision within same college: warn (not error). Two batches can have the same name.
- Admin archives a batch: `PATCH /batches/:id { is_archived: true }`. Remove the batch from all future test assignments. Past attempt records that reference this batch are preserved.
- Deleting a batch with students: block. "Batch has 34 students. Remove all students before deleting, or archive the batch."

---

## EVENT MANAGEMENT

### Event Model
```ts
interface CollegeEvent {
  _id: string;
  name: string;
  event_type: 'hackathon' | 'symposium' | 'cultural' | 'workshop' | 'seminar' | 'other';
  description: string;            // Rich text (TipTap)
  college_id: string;
  created_by: string;
  venue: string;
  event_date: string;             // ISO UTC
  registration_deadline: string;  // ISO UTC — must be <= event_date
  max_participants: number | null; // null = unlimited
  registration_fields: CustomField[]; // admin-defined form fields
  registered_students: Registration[];
  status: 'open' | 'closed' | 'cancelled' | 'completed';
  banner_image_url: string | null;
}

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  options?: string[];             // for 'select' type
  required: boolean;
}
```

### Create Event
- Step 1: Basic info (name, type, description, date, venue, max participants).
- Step 2: Registration form builder — admin can add custom fields. Pre-built fields: name, email, roll number (always collected automatically). Admin adds: team size, project idea, dietary preferences, etc.
- Step 3: Publish. Once published, `status: open`.

**Validation**:
- `registration_deadline` must be ≤ `event_date`.
- `event_date` must be ≥ today (server time).
- `max_participants` if set must be ≥ 1.

### Registrant Management
- Table of all registered students with their custom field responses.
- Columns are dynamic (based on `registration_fields` for that event).
- Filter by department.
- Export as CSV: `GET /events/:id/registrants/export` → file download.

### Edge Cases — Events
- Admin closes registration early: `PATCH /events/:id { status: 'closed', registration_deadline: now }`. Students who registered are not removed. New registrations are blocked.
- Admin cancels event after students registered: `PATCH /events/:id { status: 'cancelled' }`. Server sends a system notification to all registered students: "Event [Name] has been cancelled." This notification is stored in the DB — the admin cannot suppress it.
- Max participants reached: server uses an atomic `findOneAndUpdate` with `$inc` and a condition check (`registered_count < max_participants`) to prevent over-registration under concurrent load. The last available spot cannot be double-booked.
- Admin changes `max_participants` to a value less than the current registered count: blocking server validation — "Cannot set max participants to 45 — 62 students are already registered."

---

## STUDENT MANAGEMENT PAGE

### Student List
- Table: roll number, name, email, department, batch(es), last active, tests taken, avg score.
- Filter by department, batch, active/inactive.
- Search by name or roll number.
- Row actions: View Profile, Assign to Batch, Deactivate.

### Student Profile (admin view)
- Read-only: personal info, college, department, batch memberships.
- Attempt history: table of all tests taken by this student (within this admin's college), score, percentile, violations, submit reason.
- If the admin has `view_reports` permission: show per-test score breakdown.

### Bulk Import Students
`POST /students/bulk-import` with a CSV file:
```csv
name,email,roll_number,department,batch_name
Priya Rajan,priya@college.edu,21CSE042,CSE,2024-CSE-A
```

**Server-side processing** (async job — not synchronous response):
1. Parse CSV.
2. Validate each row (email format, roll number uniqueness, department exists, batch exists if specified).
3. Create user accounts (temporary password = roll number, force change on first login).
4. Assign to batch if `batch_name` provided and batch exists.
5. Return job ID.

Client polls `GET /jobs/:id/status` every 3 seconds. On completion, show a results modal:
- "145 students created. 3 skipped (duplicate email). 2 skipped (invalid department)."
- Download error report: CSV of the failed rows with reasons.

**Edge Cases — Import**
- CSV has 10,000 rows: show warning "This import will create 10,000 accounts. This may take several minutes." Processing is async — don't time out.
- Same email appears twice in the CSV: deduplicate before processing, flag as duplicate with the row number.
- `batch_name` in CSV doesn't exist: skip batch assignment for that student, don't fail the entire import. Report: "Batch '2023-ECE-B' not found — 12 students imported without batch assignment."
- Admin uploads an Excel file (.xlsx) instead of CSV: detect MIME type. Show: "Please upload a CSV file. Convert your spreadsheet using File → Download → CSV."

---

## REPORTS PAGE — ADMIN

### Report Types
1. **Student-specific report**: select a student → see all their attempts with score, percentile, time, violations.
2. **Test-specific report**: select a test → see all submissions, score distribution, avg score, question-wise correct rate, anomaly detection.
3. **Department report**: aggregated by department → avg score per test, participation rate.
4. **Batch report**: same as department but scoped to a batch.
5. **Comprehensive report**: all of the above, filtered by date range — used for semester-end review.

### Anomaly Detection (Test-specific report)
When viewing a test report, the system flags potential academic dishonesty:
- **Identical answer patterns**: two students answered every question in the exact same order with the same wrong answers. Show a "Similarity Alert" badge — `similarity_score: 0.94`.
- **Abnormal time per question**: student submitted in 2 minutes for a 60-minute test but got 95%. Flag as "Unusually fast."
- **High violations + high score**: student had 3 tab switch violations but scored 100%. Flag for review.

Anomalies are surfaced in the report UI as filterable badges. The admin can dismiss them (with a reason, logged to audit trail) or escalate to SuperAdmin.

**Implementation**:
Anomaly detection runs as a background job (`POST /tests/:id/analyze-anomalies`) triggered when the test transitions to `completed`. Results stored on the test document. Not recomputed on every report view — that would be too expensive.

### Report Export Architecture
- All report exports are async jobs.
- `POST /reports/export { type, filters }` → returns `{ job_id }`.
- Client polls `GET /jobs/:job_id/status` every 3 seconds.
- On `status: completed`, show download button (pre-signed S3 URL, 15-minute expiry).
- On `status: failed`, show retry button.

**Edge Cases — Reports**
- Admin requests a department report for a department with 0 test submissions: return an empty report (not an error). Show "No data for this department in the selected period."
- Admin exports a report, then the download URL expires before they click it: clicking the expired URL shows S3's 403 page. Client should validate the URL's `Expires` timestamp before showing the download button. If expired, auto-regenerate: `POST /reports/jobs/:id/regenerate-link`.
- Report for a test that was archived: allow it. The data exists. Show a banner: "This test is archived but its results are still accessible."

---

## SETTINGS PAGE

### Profile Settings
- Admin name, email (read-only — changed by SuperAdmin only).
- Profile photo upload (same pipeline as student).
- Change password.

### College Settings (only if admin has `manage_college` permission — rare)
- College name, logo (display only — functional in all admin interfaces).
- Department list: add, rename (rename doesn't affect existing student records — it's a display name), archive.
- Academic year configuration.

### Test Default Settings
Admin can set college-wide defaults that pre-fill the test creation wizard:
```ts
interface CollegeTestDefaults {
  default_time_limit: number;
  default_max_attempts: number;
  default_negative_marking: boolean;
  default_proctoring_preset: 'strict' | 'standard' | 'open';
  default_result_visibility: ResultVisibility;
}
```
These are stored on the `College` document, fetched at app init, loaded into Redux.

### Notification Settings
Toggles per notification type. Stored in admin's user document.

---

## AUDIT LOG VIEWER (ADMIN)

Route: `/settings/audit-log`

Filterable by: action type, date range. Shows the last 30 days by default. Paginated (25 per page).

Each row: timestamp | actor (admin name) | action | entity | details.

Details drawer: shows `before_snapshot` and `after_snapshot` as a JSON diff (highlight changed fields in green/red).

**Admin cannot delete or modify audit logs** — they are append-only at the database level (no update/delete routes exist for the audit log collection; the Mongoose model has no `remove` or `findByIdAndUpdate` exported — only `create` and `find`).

---

## GLOBAL STATE ARCHITECTURE

### Redux Store Shape
```ts
store = {
  auth: {
    admin: AdminUser | null,
    token: string | null,
    permissions: Permission[],
    status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated',
  },
  wizard: WizardState,         // test creation wizard — see above
  ui: {
    sidebarOpen: boolean,
    theme: 'light' | 'dark' | 'system',
    toasts: Toast[],
    globalSearch: { open: boolean, query: string, results: SearchResult[] },
  },
  college: {
    info: CollegeInfo,         // name, logo, departments, academic years
    test_defaults: CollegeTestDefaults,
    fetched_at: string,
  },
  notifications: {
    items: Notification[],
    unread_count: number,
  },
  liveMonitor: {
    active_test_id: string | null,
    student_statuses: Record<string, StudentLiveStatus>,
    violation_feed: ViolationEvent[],
    socket_status: 'connected' | 'disconnected' | 'reconnecting',
  },
}
```

**React Query manages**: test list, question list, batch list, event list, student list, reports, audit logs — all server-fetched collections.

**Redux manages**: auth session, wizard state, UI state, college info (rarely changes), live monitoring, notifications.

### React Query Configuration
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 120_000,          // 2 minutes default for admin data
      gcTime: 600_000,             // 10 minutes cache
      retry: 2,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30_000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      onError: (error) => {
        // Global mutation error handler
        toast.error(getApiErrorMessage(error));
        logToSentry(error);
      },
    },
  },
});

// Specific stale times
const testListQuery = { staleTime: 60_000 };          // tests change often
const batchListQuery = { staleTime: 300_000 };         // batches change rarely
const collegInfoQuery = { staleTime: 3_600_000 };      // changes very rarely
```

---

## PERFORMANCE REQUIREMENTS

### Bundle Strategy
- Admin shell (sidebar, header, routing): eagerly loaded.
- Every page is `React.lazy()` + `<Suspense>`.
- TipTap editor: loaded only on wizard Step 3 mount. It is the heaviest dependency (~400KB). Don't load it on the test list page.
- Recharts: loaded only on the reports page.
- `@dnd-kit/core`: loaded only on wizard Step 3.

### Database Index Requirements
These must exist before any admin operation runs in production:
```js
// Test queries
Test.index({ college_id: 1, status: 1 })
Test.index({ college_id: 1, status: 1, start_date: 1, end_date: 1 })
Test.index({ created_by: 1, created_at: -1 })

// Question queries
Question.index({ test_id: 1, order_index: 1 })
Question.index({ test_id: 1, _hash: 1 })          // duplicate detection

// Attempt queries (from admin report side)
Attempt.index({ test_id: 1, status: 1, submitted_at: -1 })
Attempt.index({ college_id: 1, test_id: 1, score: -1 })

// Student queries
User.index({ college_id: 1, department: 1, role: 1 })
User.index({ college_id: 1, roll_number: 1 }, { unique: true })

// Batch queries
Batch.index({ college_id: 1, is_archived: 1 })

// Audit logs
AuditLog.index({ college_id: 1, created_at: -1 })
AuditLog.index({ actor_id: 1, created_at: -1 })
```

### Caching Rules
- Leaderboard data: Redis cache, 60s TTL. Invalidated on any new attempt submission in that college.
- College info: Redis cache, 1 hour TTL. Invalidated on `CollegeSettings` update.
- Report aggregations: stored as computed documents after test completion (not re-computed on every view). Invalidated if admin manually re-runs anomaly detection.

---

## ERROR HANDLING MATRIX

| Scenario | Client Response | Server Response |
|---|---|---|
| Admin creates test, name already used | Show warning toast (not error) | 200 with `{ name_duplicate: true }` |
| Admin publishes test with 0 questions | Block button, show checklist item | 400 `VALIDATION_FAILED` |
| Admin publishes test that's already published | Clear wizard, navigate to test detail | 409 `ALREADY_PUBLISHED` |
| Admin edits question on live test | Disable edit controls, show tooltip | 403 `TEST_IS_LIVE` |
| Bulk import CSV, all rows invalid | Show error table, no import | 200 `{ created: 0, failed: N, errors: [] }` |
| Socket disconnect during live monitor | Show "Reconnecting..." banner, fallback to poll | N/A |
| Report export fails on server | Show retry button | 500 with `job_id` for retry |
| Admin deletes batch with active test | Block, show warning | 409 `BATCH_HAS_ACTIVE_TEST` |
| Session expires during wizard | Silent token refresh, wizard state preserved | 401 → client refreshes → retry |
| Two admins save same draft simultaneously | Last write wins, show stale-data warning | 409 with `current_version` |

---

## TESTING FIXTURES

```ts
// Admin user fixture
const adminFixture = {
  _id: 'adm_001', name: 'Dr. Rajesh Kumar', email: 'rajesh@college-a.edu',
  role: 'admin', college_id: 'col_a', department: null,
  permissions: ['create_test', 'edit_test', 'manage_questions', 'manage_batches',
                'manage_events', 'view_reports', 'export_reports', 'manage_students'],
  active: true,
};

const adminReadOnlyFixture = {
  ...adminFixture, _id: 'adm_002',
  permissions: ['view_reports'],  // report-only admin
};

// Test state fixtures — all possible states
const testFixtures = {
  draft_empty: { status: 'draft', questions: [], schedule: null },
  draft_with_questions: { status: 'draft', questions: [q1, q2, q3], schedule: null },
  scheduled: { status: 'scheduled', start_date: future(2), end_date: future(5) },
  live: { status: 'live', start_date: past(1), end_date: future(1), active_attempts: 14 },
  completed: { status: 'completed', total_submissions: 89 },
  archived: { status: 'archived', is_archived: true },
};

// Question fixtures — all types, all edge cases
const questionFixtures = {
  mcq_valid: { type: 'mcq_single', body: '<p>Q?</p>', options: [o1, o2, o3], correct: [o1.id], marks: 2 },
  mcq_no_correct: { type: 'mcq_single', options: [o1, o2], correct: [], has_error: true },
  mcq_multi_valid: { type: 'mcq_multi', options: [o1,o2,o3,o4], correct: [o1.id, o3.id], marks: 3 },
  tf_valid: { type: 'true_false', body: '<p>Is water wet?</p>', correct: ['true'], marks: 1 },
  fib_valid: { type: 'fill_blank', body: '<p>The capital of France is ___</p>', correct: ['Paris'], fib_case_sensitive: false },
  fib_with_variations: { type: 'fill_blank', correct: ['Paris'], fib_accepted_variations: ['paris', 'PARIS'] },
  paragraph_valid: { type: 'paragraph', body: '<p>Explain...</p>', marks: 10 },
  question_with_math: { type: 'mcq_single', body: '<p>Solve $x^2 + 5x + 6 = 0$</p>' },
  question_with_image: { type: 'mcq_single', body: '<p><img src="https://cdn.../diagram.png"/></p>' },
};

// Bulk upload fixtures
const bulkUploadFixtures = {
  valid_json: JSON.stringify([validQuestion1, validQuestion2]),
  invalid_json: '{ this is not json',
  empty_array: '[]',
  object_not_array: '{ "questions": [] }',
  too_large: generateJSON(10_000),  // 10k questions
  with_duplicates: JSON.stringify([validQuestion1, validQuestion1]),  // same question twice
  with_schema_errors: JSON.stringify([{ type: 'mcq_single' }]),  // missing required fields
  mixed_valid_invalid: JSON.stringify([validQuestion1, { type: 'invalid_type' }]),
};

// Network condition fixtures
const networkFixtures = {
  wizard_save_failure: () => mockAPI.put('/tests/draft/*', 503),
  publish_timeout: () => mockAPI.post('/tests/*/publish', { delay: 35_000 }),
  bulk_import_job_pending: () => mockAPI.get('/jobs/*', { status: 'processing', progress: 45 }),
  socket_disconnect: () => mockSocket.emit('disconnect'),
  concurrent_draft_edit: () => mockAPI.put('/tests/draft/*', 409, { code: 'CONCURRENT_EDIT', current_version: 7 }),
};

// Expected outcomes for every test scenario
const expectations = {
  'publish with 0 questions': { blocked: true, checklist_item: 'Add at least one question' },
  'bulk import all invalid': { created: 0, error_report: true, import_blocked: false },
  'live test edit attempt': { edit_disabled: true, tooltip_shown: true },
  'socket disconnect in live monitor': { fallback_polling: true, banner: 'Reconnecting...' },
};
```

---

## FUTUREPROOFING DECISIONS

### Question Bank (v2 feature)
Design the `Question` schema now to support a future shared question bank — questions that can be reused across tests. Add a `source_question_bank_id` nullable field. When a question is added from the bank, store the reference. If the bank question is updated, flag the test's copy as "has update available."

### Multi-language Support (v2)
Add a `locale` field to the `Test` document. The question body already stores HTML — adding RTL support means adding `dir="rtl"` to the HTML. Plan for this by ensuring the TipTap editor supports RTL text direction from day one.

### Offline-first Admin (v3)
The wizard already uses Redux + auto-save. In v3, add a Service Worker that caches the wizard state and queues API calls while offline. The architecture is ready — the wizard auto-save already has a retry mechanism. Extend it with a `background-sync` API call queue.

### Analytics Webhook (v2)
Add a `webhook_url` field to the `College` document. On every test completion, POST a summary payload to the college's configured endpoint. This allows colleges to integrate with their existing SIS (Student Information Systems) without building a full API integration.

### Question AI Assist (v3)
The TipTap editor already has a command system. Add an `/ai` command that calls `POST /ai/question-suggest { topic, difficulty, type }`. The API calls Claude with a structured prompt, returns a pre-filled question draft. The admin reviews and edits before saving. No AI-generated question goes live without human review.
