export const TEST_TYPES = Object.freeze({
  STRICT: "STRICT",
  STANDARD: "STANDARD",
  OPEN: "OPEN",
});

export const PROCTORING_PRESETS = Object.freeze({
  STRICT_EXAM: "STRICT_EXAM",
  STANDARD_TEST: "STANDARD_TEST",
  OPEN_TEST: "OPEN_TEST",
});

export const PRESET_CONFIGS = Object.freeze({
  [PROCTORING_PRESETS.STRICT_EXAM]: Object.freeze({
    enabled: true,
    fullscreenRequired: true,
    tabSwitch: "monitored",
    copyPaste: "monitored",
    windowBlur: true,
    screenshotDetection: true,
    rightClickDisabled: true,
    devtoolsDetection: true,
    violationThreshold: 2,
    autoNextSingle: false,
    paragraphWordLimit: 250,
  }),
  [PROCTORING_PRESETS.STANDARD_TEST]: Object.freeze({
    enabled: true,
    fullscreenRequired: false,
    tabSwitch: "monitored",
    copyPaste: "monitored",
    windowBlur: true,
    screenshotDetection: false,
    rightClickDisabled: true,
    devtoolsDetection: true,
    violationThreshold: 3,
    autoNextSingle: false,
    paragraphWordLimit: 250,
  }),
  [PROCTORING_PRESETS.OPEN_TEST]: Object.freeze({
    enabled: true,
    fullscreenRequired: false,
    tabSwitch: "allowed",
    copyPaste: "allowed",
    windowBlur: false,
    screenshotDetection: false,
    rightClickDisabled: false,
    devtoolsDetection: false,
    violationThreshold: 8,
    autoNextSingle: false,
    paragraphWordLimit: 250,
  }),
});

export const DEFAULT_TEST_TYPE = TEST_TYPES.STANDARD;
export const DEFAULT_PROCTORING_PRESET = PROCTORING_PRESETS.STANDARD_TEST;
export const DEFAULT_RESTRICTIONS = Object.freeze({
  ...PRESET_CONFIGS[DEFAULT_PROCTORING_PRESET],
});

const LEGACY_OPEN_PRESET = "OPEN_ASSIGNMENT";

const normalizeBoolean = (value, fallback) => (typeof value === "boolean" ? value : fallback);

const normalizeInteger = (value, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const normalizeMonitoringMode = (value, fallback) => {
  if (typeof value === "boolean") {
    return value ? "monitored" : "allowed";
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "allowed") return "allowed";
  if (normalized === "monitored") return "monitored";
  return fallback;
};

export const derivePresetFromTestType = (testType) => {
  const normalized = String(testType || "").trim().toUpperCase();
  if (normalized === TEST_TYPES.STRICT) return PROCTORING_PRESETS.STRICT_EXAM;
  if (normalized === TEST_TYPES.OPEN) return PROCTORING_PRESETS.OPEN_TEST;
  return PROCTORING_PRESETS.STANDARD_TEST;
};

export const deriveTestTypeFromPreset = (preset) => {
  const normalized = String(preset || "").trim().toUpperCase();
  if (normalized === PROCTORING_PRESETS.STRICT_EXAM) return TEST_TYPES.STRICT;
  if (normalized === PROCTORING_PRESETS.OPEN_TEST || normalized === LEGACY_OPEN_PRESET) return TEST_TYPES.OPEN;
  return TEST_TYPES.STANDARD;
};

export const normalizeTestType = (value, fallback = DEFAULT_TEST_TYPE) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (Object.values(TEST_TYPES).includes(normalized)) {
    return normalized;
  }
  if (normalized === LEGACY_OPEN_PRESET) {
    return TEST_TYPES.OPEN;
  }
  return fallback;
};

export const normalizeProctoringPreset = (value, fallback = DEFAULT_PROCTORING_PRESET) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === LEGACY_OPEN_PRESET) {
    return PROCTORING_PRESETS.OPEN_TEST;
  }
  if (Object.values(PROCTORING_PRESETS).includes(normalized)) {
    return normalized;
  }
  return fallback;
};

export const createDefaultRestrictions = (preset = DEFAULT_PROCTORING_PRESET) => ({
  ...(PRESET_CONFIGS[preset] || PRESET_CONFIGS[DEFAULT_PROCTORING_PRESET]),
});

export const normalizeRestrictions = (input = {}, { fallbackPreset = DEFAULT_PROCTORING_PRESET } = {}) => {
  const base = createDefaultRestrictions(fallbackPreset);

  return {
    enabled: normalizeBoolean(input.enabled, base.enabled),
    fullscreenRequired: normalizeBoolean(
      input.fullscreenRequired ?? input.fullscreen_required ?? input.fullscreen,
      base.fullscreenRequired
    ),
    tabSwitch: normalizeMonitoringMode(input.tabSwitch ?? input.tab_switch, base.tabSwitch),
    copyPaste: normalizeMonitoringMode(input.copyPaste ?? input.copy_paste, base.copyPaste),
    windowBlur: normalizeBoolean(input.windowBlur ?? input.window_blur, base.windowBlur),
    screenshotDetection: normalizeBoolean(
      input.screenshotDetection ?? input.screenshot_detection,
      base.screenshotDetection
    ),
    rightClickDisabled: normalizeBoolean(
      input.rightClickDisabled ?? input.right_click_disabled ?? input.rightClick,
      base.rightClickDisabled
    ),
    devtoolsDetection: normalizeBoolean(
      input.devtoolsDetection ?? input.devtools_detection,
      base.devtoolsDetection
    ),
    violationThreshold: normalizeInteger(
      input.violationThreshold ?? input.violation_threshold ?? input.threshold ?? input.violationLimit,
      {
        fallback: base.violationThreshold,
        min: 1,
        max: 20,
      }
    ),
    autoNextSingle: normalizeBoolean(
      input.autoNextSingle ?? input.auto_next_single,
      base.autoNextSingle
    ),
    paragraphWordLimit: normalizeInteger(
      input.paragraphWordLimit ?? input.paragraph_word_limit,
      {
        fallback: base.paragraphWordLimit,
        min: 10,
        max: 5000,
      }
    ),
  };
};

export const resolveIncomingTestConfig = (test = {}) => {
  const testType = normalizeTestType(test?.testType ?? test?.test_type);
  const proctoringPreset = normalizeProctoringPreset(
    test?.proctoringPreset ?? test?.proctoring_preset,
    derivePresetFromTestType(testType)
  );

  const restrictions = normalizeRestrictions(
    {
      ...(test?.proctoringConfig || {}),
      ...(test?.proctoring_config || {}),
      enabled: test?.proctoringEnabled ?? test?.proctoring_enabled,
      fullscreenRequired: test?.requireFullscreen ?? test?.require_fullscreen,
      tabSwitch:
        test?.restrictTabSwitch != null
          ? (test.restrictTabSwitch ? "monitored" : "allowed")
          : undefined,
      copyPaste:
        test?.restrictCopyPaste != null
          ? (test.restrictCopyPaste ? "monitored" : "allowed")
          : undefined,
      windowBlur: test?.monitorWindowBlur ?? test?.monitor_window_blur,
      screenshotDetection: test?.detectScreenshot ?? test?.detect_screenshot,
      rightClickDisabled: test?.restrictRightClick ?? test?.restrict_right_click,
      devtoolsDetection: test?.detectDevtools ?? test?.detect_devtools,
      violationThreshold: test?.violationLimit ?? test?.violation_limit,
      autoNextSingle: test?.autoNextSingle ?? test?.auto_next_single,
      paragraphWordLimit: test?.paragraphWordLimit ?? test?.paragraph_word_limit,
    },
    { fallbackPreset: proctoringPreset }
  );

  return {
    testType,
    proctoringPreset,
    restrictions,
  };
};

export const getDefaultFormPatchFromAdminSettings = (settings = {}) => {
  const defaults = settings?.defaultTestConfig || {};
  const testType = normalizeTestType(defaults?.testType, DEFAULT_TEST_TYPE);
  const proctoringPreset = normalizeProctoringPreset(
    defaults?.proctoringPreset,
    derivePresetFromTestType(testType)
  );

  return {
    durationMins: normalizeInteger(defaults?.durationMins, { fallback: 60, min: 5, max: 480 }),
    attemptsAllowed: normalizeInteger(defaults?.attemptsAllowed, { fallback: 1, min: 1, max: 10 }),
    evaluationRule: ["BEST_ATTEMPT", "LAST_ATTEMPT"].includes(String(defaults?.evaluationRule || "").toUpperCase())
      ? String(defaults.evaluationRule).toUpperCase()
      : "BEST_ATTEMPT",
    testType,
    proctoringPreset,
    restrictions: normalizeRestrictions(
      {
        violationThreshold: defaults?.violationThreshold,
      },
      { fallbackPreset: proctoringPreset }
    ),
  };
};
