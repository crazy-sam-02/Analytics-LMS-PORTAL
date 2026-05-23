# Production Load Testing

Use these k6 scripts against a production-like environment with MongoDB and Redis enabled.

## Required Test Data

Create active student accounts that are assigned to an active test. Pass either one student:

```powershell
$env:STUDENT_IDENTIFIER="student@example.com"
$env:STUDENT_PASSWORD="password"
$env:TEST_ID="optional-test-id"
npm run load:exam-flow
```

or a JSON array of many students:

```powershell
$env:STUDENTS_JSON='[{"identifier":"student1@example.com","password":"password1"},{"identifier":"student2@example.com","password":"password2"}]'
$env:TEST_ID="optional-test-id"
npm run load:exam-flow
```

## 2000 Concurrent User Run

Run in stages and watch API, MongoDB, Redis, CPU, and memory metrics.

```powershell
$env:BASE_URL="http://localhost:5000"
$env:STUDENTS_JSON='[...]'
$env:TEST_ID="..."
$env:RUN_SUBMIT="false"
npm run load:exam-flow:2000
```

Keep `RUN_SUBMIT=false` for the first large run so repeated test submissions do not consume real attempts. Use a disposable test and disposable students when testing submit behavior.

## Pass Criteria

- `http_req_failed` below 1%
- p95 request latency below 1000ms for exam APIs
- answer-save p95 below 750ms
- Redis health remains `ok`
- MongoDB CPU and slow queries remain stable
- Node memory does not climb continuously
