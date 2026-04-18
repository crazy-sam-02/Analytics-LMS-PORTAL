$ErrorActionPreference='Stop'

$base = 'http://localhost:5001/api'

$adminLogin = Invoke-RestMethod -Uri "$base/admin/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email='admin@evergreen.edu'; password='Admin@12345' } | ConvertTo-Json -Compress)
$adminToken = $adminLogin.accessToken

$now = Get-Date
$start = $now.ToString('yyyy-MM-ddTHH:mm')
$end = $now.AddHours(2).ToString('yyyy-MM-ddTHH:mm')
$name = "E2E Monitoring " + $now.ToString('yyyyMMddHHmmss')

$createBody = @{
  name = $name
  description = 'Automated E2E monitoring validation test'
  subject = 'E2E'
  durationMins = 60
  totalMarks = 2
  attemptsAllowed = 1
  evaluationRule = 'BEST_ATTEMPT'
  startsAt = $start
  endsAt = $end
  assignmentMethod = 'department_wise'
  departmentId = $null
  batchIds = @()
  questionInputMode = 'manual'
  questions = @(
    @{
      type = 'mcq'
      question = 'E2E question one'
      options = @('A','B')
      correctAnswer = 'A'
      marks = 1
      difficulty = 'MEDIUM'
    },
    @{
      type = 'true_false'
      question = 'E2E question two'
      options = @('True','False')
      correctAnswer = $true
      marks = 1
      difficulty = 'EASY'
    }
  )
  restrictions = @{
    fullscreenRequired = $true
    tabSwitch = 'monitored'
    copyPaste = 'monitored'
    windowBlur = $true
    screenshotDetection = $true
    rightClickDisabled = $true
    devtoolsDetection = $true
    violationThreshold = 3
  }
  publishState = 'PUBLISH_NOW'
  skipOverlapCheck = $true
} | ConvertTo-Json -Depth 10 -Compress

$created = Invoke-RestMethod -Uri "$base/admin/tests" -Method Post -Headers @{ Authorization = "Bearer $adminToken" } -ContentType 'application/json' -Body $createBody
$testId = $created.id
if (-not $testId) {
  throw 'Created test id missing'
}

$studentLogin = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ identifier='student1@evergreen.edu'; password='Password@123' } | ConvertTo-Json -Compress)
$studentToken = $studentLogin.accessToken
$monitorBefore = Invoke-RestMethod -Uri "$base/admin/tests/$testId/monitoring" -Headers @{ Authorization = "Bearer $adminToken" }

$start = Invoke-RestMethod -Uri "$base/tests/$testId/start" -Method Post -Headers @{ Authorization = "Bearer $studentToken" } -ContentType 'application/json' -Body '{}'
$submissionId = $start.submission.id
if (-not $submissionId) {
  throw 'Submission id missing from start response'
}

$violationBody = @{ submissionId = $submissionId; type = 'TAB_SWITCH'; metadata = @{ source = 'e2e' } } | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$base/tests/$testId/violation" -Method Post -Headers @{ Authorization = "Bearer $studentToken" } -ContentType 'application/json' -Body $violationBody | Out-Null

$monitorAfter = Invoke-RestMethod -Uri "$base/admin/tests/$testId/monitoring" -Headers @{ Authorization = "Bearer $adminToken" }
$row = $monitorAfter.studentTable | Where-Object { $_.submissionId -eq $submissionId } | Select-Object -First 1

$extendBody = @{ submissionId = $submissionId; minutes = 10 } | ConvertTo-Json -Compress
$extend = Invoke-RestMethod -Uri "$base/admin/tests/$testId/monitoring/extend-time" -Method Post -Headers @{ Authorization = "Bearer $adminToken" } -ContentType 'application/json' -Body $extendBody

$forceBody = @{ submissionId = $submissionId; reason = 'E2E moderation check' } | ConvertTo-Json -Compress
$force = Invoke-RestMethod -Uri "$base/admin/tests/$testId/monitoring/force-submit" -Method Post -Headers @{ Authorization = "Bearer $adminToken" } -ContentType 'application/json' -Body $forceBody

$monitorFinal = Invoke-RestMethod -Uri "$base/admin/tests/$testId/monitoring" -Headers @{ Authorization = "Bearer $adminToken" }
$stillThere = $monitorFinal.studentTable | Where-Object { $_.submissionId -eq $submissionId } | Select-Object -First 1

[PSCustomObject]@{
  TestId = $testId
  BeforeActive = [int]($monitorBefore.studentTable.Count)
  AfterStartActive = [int]($monitorAfter.studentTable.Count)
  FoundAttemptInMonitor = [bool]($null -ne $row)
  ExtendApplied = [bool]($null -ne $extend)
  ForceSubmitted = [bool]($null -ne $force)
  PresentAfterForce = [bool]($null -ne $stillThere)
  ViolationsInFeed = [int](($monitorAfter.violationFeed | Where-Object { $_.submissionId -eq $submissionId }).Count)
} | Format-List
