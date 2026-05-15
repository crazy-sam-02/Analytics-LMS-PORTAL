const TEST_TYPES = Object.freeze({
  STRICT: "STRICT",
  STANDARD: "STANDARD",
  OPEN: "OPEN",
});

const PROCTORING_PRESETS = Object.freeze({
  STRICT_EXAM: "STRICT_EXAM",
  STANDARD_TEST: "STANDARD_TEST",
  OPEN_TEST: "OPEN_TEST",
});

const PRESET_CONFIGS = Object.freeze({
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

const DEFAULT_TEST_CONFIGURATION = Object.freeze({
  testType: TEST_TYPES.STANDARD,
  proctoringPreset: PROCTORING_PRESETS.STANDARD_TEST,
  proctoringConfig: PRESET_CONFIGS[PROCTORING_PRESETS.STANDARD_TEST],
});

const SYSTEM_DEFAULT_TEST_SETTINGS = Object.freeze({
  durationMins: 60,
  attemptsAllowed: 1,
  evaluationRule: "BEST_ATTEMPT",
  ...DEFAULT_TEST_CONFIGURATION,
});

const LEGACY_OPEN_PRESET = "OPEN_ASSIGNMENT";

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const pickDefined = (entries) =>
  Object.fromEntries(entries.filter(([, value]) => typeof value !== "undefined"));

const normalizeBoolean = (value, fallback) => {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
};

const normalizeInteger = (value, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const normalizeMonitoringMode = (value, fallback) => {
  if (typeof value === "boolean") {
    return value ? "monitored" : "allowed";
  }

  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "allowed") {
    return "allowed";
  }
  if (normalized === "monitored") {
    return "monitored";
  }
  return fallback;
};

const derivePresetFromTestType = (testType) => {
  switch (testType) {
    case TEST_TYPES.STRICT:
      return PROCTORING_PRESETS.STRICT_EXAM;
    case TEST_TYPES.OPEN:
      return PROCTORING_PRESETS.OPEN_TEST;
    case TEST_TYPES.STANDARD:
    default:
      return PROCTORING_PRESETS.STANDARD_TEST;
  }
};

const normalizeTestType = (value, fallback = TEST_TYPES.STANDARD) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (Object.values(TEST_TYPES).includes(normalized)) {
    return normalized;
  }

  if (normalized === LEGACY_OPEN_PRESET) {
    return TEST_TYPES.OPEN;
  }

  return fallback;
};

const normalizeProctoringPreset = (value, fallback) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === LEGACY_OPEN_PRESET) {
    return PROCTORING_PRESETS.OPEN_TEST;
  }
  if (Object.values(PROCTORING_PRESETS).includes(normalized)) {
    return normalized;
  }
  return fallback;
};

const toStoredMonitoringMode = (restricted, fallback = "monitored") =>
  typeof restricted === "boolean" ? (restricted ? "monitored" : "allowed") : fallback;

const normalizeProctoringConfig = (input = {}, { baseConfig } = {}) => {
  const base = {
    ...(baseConfig || DEFAULT_TEST_CONFIGURATION.proctoringConfig),
  };

  const normalized = {
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
      input.violationThreshold ?? input.violation_threshold ?? input.violationLimit ?? input.violation_limit,
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

  return normalized;
};

const extractResolvedTestConfiguration = (test = {}) => {
  const inferredType = normalizeTestType(test.testType);
  const presetFallback = derivePresetFromTestType(inferredType);
  const normalizedPreset = normalizeProctoringPreset(test.proctoringPreset, presetFallback);
  const baseConfig = PRESET_CONFIGS[normalizedPreset] || DEFAULT_TEST_CONFIGURATION.proctoringConfig;
  const storedConfig = isPlainObject(test.proctoringConfig)
    ? test.proctoringConfig
    : isPlainObject(test.proctoring_config)
      ? test.proctoring_config
      : {};

  const normalizedConfig = normalizeProctoringConfig(
    {
      ...storedConfig,
      enabled: storedConfig.enabled ?? test.proctoringEnabled,
      fullscreenRequired:
        storedConfig.fullscreenRequired
        ?? storedConfig.fullscreen_required
        ?? test.requireFullscreen,
      tabSwitch:
        storedConfig.tabSwitch
        ?? storedConfig.tab_switch
        ?? toStoredMonitoringMode(test.restrictTabSwitch, baseConfig.tabSwitch),
      copyPaste:
        storedConfig.copyPaste
        ?? storedConfig.copy_paste
        ?? toStoredMonitoringMode(test.restrictCopyPaste, baseConfig.copyPaste),
      windowBlur:
        storedConfig.windowBlur
        ?? storedConfig.window_blur
        ?? test.monitorWindowBlur,
      screenshotDetection:
        storedConfig.screenshotDetection
        ?? storedConfig.screenshot_detection
        ?? test.detectScreenshot,
      rightClickDisabled:
        storedConfig.rightClickDisabled
        ?? storedConfig.right_click_disabled
        ?? test.restrictRightClick,
      devtoolsDetection:
        storedConfig.devtoolsDetection
        ?? storedConfig.devtools_detection
        ?? test.detectDevtools,
      violationThreshold:
        storedConfig.violationThreshold
        ?? storedConfig.violation_threshold
        ?? test.violationLimit,
      autoNextSingle:
        storedConfig.autoNextSingle
        ?? storedConfig.auto_next_single
        ?? test.autoNextSingle,
      paragraphWordLimit:
        storedConfig.paragraphWordLimit
        ?? storedConfig.paragraph_word_limit
        ?? test.paragraphWordLimit,
    },
    { baseConfig }
  );

  return {
    testType: inferredType,
    proctoringPreset: normalizedPreset,
    proctoringConfig: normalizedConfig,
  };
};

const resolvePersistedTestConfiguration = ({
  existingTest = null,
  testType,
  proctoringPreset,
  restrictions,
  proctoringConfig,
} = {}) => {
  const existing = extractResolvedTestConfiguration(existingTest || {});
  const resolvedTestType = normalizeTestType(
    testType,
    existing.testType || DEFAULT_TEST_CONFIGURATION.testType
  );
  const resolvedPreset = normalizeProctoringPreset(
    proctoringPreset,
    existing.proctoringPreset || derivePresetFromTestType(resolvedTestType)
  );
  const baseConfig = PRESET_CONFIGS[resolvedPreset] || DEFAULT_TEST_CONFIGURATION.proctoringConfig;
  const mergedConfig = normalizeProctoringConfig(
    {
      ...existing.proctoringConfig,
      ...(isPlainObject(proctoringConfig) ? proctoringConfig : {}),
      ...(isPlainObject(restrictions) ? restrictions : {}),
    },
    { baseConfig }
  );

  return {
    testType: resolvedTestType,
    proctoringPreset: resolvedPreset,
    proctoringConfig: mergedConfig,
    persistenceFields: {
      testType: resolvedTestType,
      proctoringPreset: resolvedPreset,
      proctoringEnabled: mergedConfig.enabled,
      restrictTabSwitch: mergedConfig.tabSwitch === "monitored",
      restrictCopyPaste: mergedConfig.copyPaste === "monitored",
      restrictRightClick: mergedConfig.rightClickDisabled,
      requireFullscreen: mergedConfig.fullscreenRequired,
      violationLimit: mergedConfig.violationThreshold,
      monitorWindowBlur: mergedConfig.windowBlur,
      detectScreenshot: mergedConfig.screenshotDetection,
      detectDevtools: mergedConfig.devtoolsDetection,
      autoNextSingle: mergedConfig.autoNextSingle,
      paragraphWordLimit: mergedConfig.paragraphWordLimit,
      proctoringConfig: mergedConfig,
    },
  };
};

const toStudentProctoringConfig = (config = {}) => ({
  enabled: Boolean(config.enabled),
  threshold: Number(config.violationThreshold || 0),
  fullscreen_required: Boolean(config.fullscreenRequired),
  tab_switch: config.tabSwitch === "allowed" ? "allowed" : "monitored",
  copy_paste: config.copyPaste === "allowed" ? "allowed" : "monitored",
  window_blur: Boolean(config.windowBlur),
  screenshot_detection: Boolean(config.screenshotDetection),
  right_click_disabled: Boolean(config.rightClickDisabled),
  devtools_detection: Boolean(config.devtoolsDetection),
  auto_next_single: Boolean(config.autoNextSingle),
  paragraph_word_limit: Number(config.paragraphWordLimit || 0),
});

const attachResolvedTestConfiguration = (test) => {
  if (!test || typeof test !== "object") {
    return test;
  }

  const resolved = extractResolvedTestConfiguration(test);
  return {
    ...test,
    testType: resolved.testType,
    test_type: resolved.testType,
    proctoringPreset: resolved.proctoringPreset,
    proctoring_preset: resolved.proctoringPreset,
    proctoringConfig: resolved.proctoringConfig,
    proctoring_config: toStudentProctoringConfig(resolved.proctoringConfig),
  };
};

const getAdminDefaultFormPatchFromSettings = (settings = {}) => {
  const defaultTestConfig = isPlainObject(settings.defaultTestConfig) ? settings.defaultTestConfig : {};
  return {
    durationMins: normalizeInteger(defaultTestConfig.durationMins, {
      fallback: SYSTEM_DEFAULT_TEST_SETTINGS.durationMins,
      min: 5,
      max: 480,
    }),
    attemptsAllowed: normalizeInteger(defaultTestConfig.attemptsAllowed, {
      fallback: SYSTEM_DEFAULT_TEST_SETTINGS.attemptsAllowed,
      min: 1,
      max: 10,
    }),
    evaluationRule: ["BEST_ATTEMPT", "LAST_ATTEMPT"].includes(defaultTestConfig.evaluationRule)
      ? defaultTestConfig.evaluationRule
      : SYSTEM_DEFAULT_TEST_SETTINGS.evaluationRule,
    testType: normalizeTestType(defaultTestConfig.testType, SYSTEM_DEFAULT_TEST_SETTINGS.testType),
    proctoringPreset: normalizeProctoringPreset(
      defaultTestConfig.proctoringPreset,
      SYSTEM_DEFAULT_TEST_SETTINGS.proctoringPreset
    ),
    restrictions: {
      ...SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig,
      violationThreshold: normalizeInteger(defaultTestConfig.violationThreshold, {
        fallback: SYSTEM_DEFAULT_TEST_SETTINGS.proctoringConfig.violationThreshold,
        min: 1,
        max: 20,
      }),
    },
  };
};

module.exports = {
  TEST_TYPES,
  PROCTORING_PRESETS,
  PRESET_CONFIGS,
  DEFAULT_TEST_CONFIGURATION,
  SYSTEM_DEFAULT_TEST_SETTINGS,
  derivePresetFromTestType,
  normalizeTestType,
  normalizeProctoringPreset,
  normalizeProctoringConfig,
  resolvePersistedTestConfiguration,
  extractResolvedTestConfiguration,
  toStudentProctoringConfig,
  attachResolvedTestConfiguration,
  getAdminDefaultFormPatchFromSettings,
  pickDefined,
};
