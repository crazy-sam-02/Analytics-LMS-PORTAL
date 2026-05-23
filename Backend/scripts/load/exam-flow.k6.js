import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const STUDENTS_JSON = __ENV.STUDENTS_JSON || "";
const STUDENT_IDENTIFIER = __ENV.STUDENT_IDENTIFIER || "";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "";
const TEST_ID = __ENV.TEST_ID || "";
const THINK_TIME_SECONDS = Number(__ENV.THINK_TIME_SECONDS || 1);
const EXPECT_STATUS = (__ENV.EXPECT_STATUS || "200,201").split(",").map((item) => Number(item.trim()));
const RUN_SUBMIT = String(__ENV.RUN_SUBMIT || "false").toLowerCase() === "true";
const DEBUG_FAILURES = String(__ENV.DEBUG_FAILURES || "true").toLowerCase() !== "false";

const apiFailures = new Counter("api_failures");
const startSuccessRate = new Rate("exam_start_success");
const answerLatency = new Trend("answer_save_latency_ms");

export const options = {
  scenarios: {
    warmup: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.WARMUP_DURATION || "2m", target: Number(__ENV.WARMUP_USERS || 100) },
        { duration: __ENV.HOLD_DURATION || "5m", target: Number(__ENV.TARGET_USERS || 500) },
        { duration: __ENV.RAMPDOWN_DURATION || "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    exam_start_success: ["rate>0.95"],
    answer_save_latency_ms: ["p(95)<750"],
  },
};

const parseStudents = () => {
  if (STUDENTS_JSON) {
    try {
      const parsed = JSON.parse(STUDENTS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (error) {
      fail(`Invalid STUDENTS_JSON: ${error.message}`);
    }
  }

  if (STUDENT_IDENTIFIER && STUDENT_PASSWORD) {
    return [{ identifier: STUDENT_IDENTIFIER, password: STUDENT_PASSWORD }];
  }

  return [];
};

const students = parseStudents();

const pickStudent = () => students[(__VU - 1) % students.length];

const requestHeaders = (token) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const expectOk = (response, label) => {
  const ok = EXPECT_STATUS.includes(response.status);
  if (!ok) {
    apiFailures.add(1, { route: label, status: String(response.status) });
    if (DEBUG_FAILURES) {
      console.error(`${label} failed: status=${response.status} body=${String(response.body || "").slice(0, 500)}`);
    }
  }
  check(response, {
    [`${label} status ok`]: () => ok,
  });
  return ok;
};

const safeJson = (response) => {
  try {
    return response.json();
  } catch {
    return {};
  }
};

const getFirstQuestionId = (payload) => {
  if (Array.isArray(payload.question_order) && payload.question_order.length > 0) {
    return payload.question_order[0];
  }
  if (Array.isArray(payload.questions) && payload.questions.length > 0) {
    return payload.questions[0].id;
  }
  return null;
};

const clientSessionId = () => `k6-client-vu-${__VU}-iter-${__ITER}`;

const canStartOrResume = (test) => {
  if (!test) return false;
  if (test.submissionId) return true;
  if (test.isCompleted) return false;
  if (typeof test.attemptsRemaining === "number") return test.attemptsRemaining > 0;
  return true;
};

const selectStartableTestId = (tests) => {
  const items = Array.isArray(tests) ? tests : [];

  if (TEST_ID) {
    const requested = items.find((test) => String(test.id) === String(TEST_ID));
    if (!requested) {
      apiFailures.add(1, { route: "test_selection", status: "test_not_visible_to_student" });
      if (DEBUG_FAILURES) {
        console.error(`test_selection failed: TEST_ID=${TEST_ID} is not in /api/tests/ongoing for this student`);
      }
      return null;
    }

    if (!canStartOrResume(requested)) {
      apiFailures.add(1, { route: "test_selection", status: "test_not_startable" });
      if (DEBUG_FAILURES) {
        console.error(`test_selection failed: TEST_ID=${TEST_ID} has no remaining attempts and no active submission`);
      }
      return null;
    }

    return requested.id;
  }

  const selected = items.find(canStartOrResume);
  return selected?.id || null;
};

export default function examFlow() {
  if (students.length === 0) {
    fail("Provide STUDENTS_JSON or STUDENT_IDENTIFIER/STUDENT_PASSWORD for load testing.");
  }

  const student = pickStudent();
  const loginResponse = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ identifier: student.identifier, password: student.password }),
    { headers: requestHeaders() }
  );

  if (!expectOk(loginResponse, "login")) {
    return;
  }

  const loginPayload = safeJson(loginResponse);
  const token = loginPayload.accessToken;
  if (!token) {
    apiFailures.add(1, { route: "login", status: "missing_token" });
    return;
  }

  const listResponse = http.get(`${BASE_URL}/api/tests/ongoing`, { headers: requestHeaders(token) });
  expectOk(listResponse, "ongoing_tests");

  const selectedTestId = selectStartableTestId(safeJson(listResponse));
  if (!selectedTestId) {
    apiFailures.add(1, { route: "test_selection", status: "missing_test" });
    return;
  }

  sleep(THINK_TIME_SECONDS);

  const startResponse = http.post(
    `${BASE_URL}/api/tests/${selectedTestId}/start`,
    JSON.stringify({ clientSessionId: clientSessionId() }),
    { headers: requestHeaders(token) }
  );
  const started = expectOk(startResponse, "start_test");
  startSuccessRate.add(started);
  if (!started) {
    return;
  }

  const startPayload = safeJson(startResponse);
  const submissionId = startPayload.submission?.id || startPayload.submissionId || startPayload.attempt_id;
  const questionId = getFirstQuestionId(startPayload);

  if (!submissionId) {
    apiFailures.add(1, { route: "start_test", status: "missing_submission" });
    return;
  }

  const heartbeatResponse = http.post(
    `${BASE_URL}/api/tests/${selectedTestId}/heartbeat`,
    JSON.stringify({ submissionId, clientSessionId: clientSessionId() }),
    { headers: requestHeaders(token) }
  );
  expectOk(heartbeatResponse, "heartbeat");

  if (questionId) {
    const answerResponse = http.post(
      `${BASE_URL}/api/tests/${selectedTestId}/answer`,
      JSON.stringify({
        submissionId,
        questionId,
        selectedOption: "A",
        selectedOptions: ["A"],
        answerText: "",
        markedForReview: false,
        clientSessionId: clientSessionId(),
      }),
      { headers: requestHeaders(token) }
    );
    answerLatency.add(answerResponse.timings.duration);
    expectOk(answerResponse, "save_answer");
  }

  if (RUN_SUBMIT) {
    const submitResponse = http.post(
      `${BASE_URL}/api/tests/${selectedTestId}/submit`,
      JSON.stringify({ submissionId, reason: "load_test", clientSessionId: clientSessionId() }),
      { headers: requestHeaders(token) }
    );
    expectOk(submitResponse, "submit_test");
  }

  sleep(THINK_TIME_SECONDS);
}
