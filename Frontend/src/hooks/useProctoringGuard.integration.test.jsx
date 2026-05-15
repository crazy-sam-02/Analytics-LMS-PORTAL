import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { renderHook, act } from "@testing-library/react";
import { vi, describe, beforeEach, afterEach, expect, it } from "vitest";
import testReducer from "@/features/Students/testSlice";
import { useProctoringGuard } from "@/hooks/useProctoringGuard";
import { studentApi } from "@/services/studentApi";

vi.mock("@/services/studentApi", () => ({
  studentApi: {
    reportAttemptViolation: vi.fn(),
  },
}));

vi.mock("@/services/testSocket", () => ({
  connectTestSocket: () => ({
    emit: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

const createStore = () =>
  configureStore({
    reducer: { test: testReducer },
    preloadedState: {
      test: {
        ongoing: [],
        upcoming: [],
        testsLoading: false,
        attempt_id: "attempt-1",
        test_id: "test-1",
        question_order: [],
        questions: {},
        answers: {},
        changed_answer_ids: [],
        current_question_index: 0,
        marked_for_review: [],
        server_end_time: Date.now() + 600000,
        violations: { tab_switch: 0, copy: 0, paste: 0, window_blur: 0, total: 0 },
        proctoring_config: {
          enabled: true,
          threshold: 3,
          fullscreen_required: false,
          auto_next_single: false,
          paragraph_word_limit: 250,
        },
        save_status: "idle",
        submit_status: "idle",
        start_status: "idle",
        load_status: "idle",
        heartbeat_status: "idle",
        last_error: null,
        pending_submit: null,
      },
    },
  });

describe("useProctoringGuard integration", () => {
  const originalInnerWidth = window.innerWidth;
  const originalMatchMedia = window.matchMedia;
  const originalMaxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
  const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");

  const setMobileLikeEnvironment = ({ width = 390, touchPoints = 5, coarsePointer = true } = {}) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });

    window.matchMedia = vi.fn((query) => ({
      matches: coarsePointer && String(query).includes("(pointer: coarse)"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: touchPoints,
    });
  };

  const setDocumentVisibility = ({ hidden, visibilityState }) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
  };

  const restoreEnvironment = () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });

    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    }

    if (originalMaxTouchPointsDescriptor) {
      Object.defineProperty(navigator, "maxTouchPoints", originalMaxTouchPointsDescriptor);
    }

    if (originalHiddenDescriptor) {
      Object.defineProperty(document, "hidden", originalHiddenDescriptor);
    }

    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, "visibilityState", originalVisibilityStateDescriptor);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    studentApi.reportAttemptViolation.mockResolvedValue({ autoSubmitted: false, violationCount: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnvironment();
  });

  it("records only one violation for copy cascade events", async () => {
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    renderHook(
      () =>
        useProctoringGuard({
          attemptId: "attempt-1",
          testId: "test-1",
          enabled: true,
          paused: false,
          threshold: 3,
          fullscreenRequired: false,
          onThresholdExceeded: vi.fn(),
        }),
      { wrapper }
    );

    act(() => {
      document.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event("blur"));
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(300);
    });

    expect(store.getState().test.violations.total).toBe(1);
  });

  it("triggers threshold callback only once after crossing threshold", async () => {
    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const onThresholdExceeded = vi.fn();

    renderHook(
      () =>
        useProctoringGuard({
          attemptId: "attempt-1",
          testId: "test-1",
          enabled: true,
          paused: false,
          threshold: 3,
          fullscreenRequired: false,
          onThresholdExceeded,
        }),
      { wrapper }
    );

    act(() => {
      document.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(1300);

      document.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(1300);

      document.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(1300);

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "PrintScreen", bubbles: true }));
      vi.advanceTimersByTime(1300);
    });

    expect(store.getState().test.violations.total).toBeGreaterThanOrEqual(3);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onThresholdExceeded).toHaveBeenCalledTimes(1);
  });

  it("does not report mobile blur when page remains visible", () => {
    setMobileLikeEnvironment();
    setDocumentVisibility({ hidden: false, visibilityState: "visible" });

    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    renderHook(
      () =>
        useProctoringGuard({
          attemptId: "attempt-1",
          testId: "test-1",
          enabled: true,
          paused: false,
          threshold: 3,
          fullscreenRequired: false,
          onThresholdExceeded: vi.fn(),
        }),
      { wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(1600);
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(250);
    });

    expect(store.getState().test.violations.total).toBe(0);
    expect(studentApi.reportAttemptViolation).not.toHaveBeenCalled();
  });

  it("reports mobile blur only when page is backgrounded", () => {
    setMobileLikeEnvironment();
    setDocumentVisibility({ hidden: true, visibilityState: "hidden" });

    const store = createStore();
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    renderHook(
      () =>
        useProctoringGuard({
          attemptId: "attempt-1",
          testId: "test-1",
          enabled: true,
          paused: false,
          threshold: 3,
          fullscreenRequired: false,
          onThresholdExceeded: vi.fn(),
        }),
      { wrapper }
    );

    act(() => {
      vi.advanceTimersByTime(1600);
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(250);
    });

    expect(store.getState().test.violations.total).toBe(1);
    expect(studentApi.reportAttemptViolation).toHaveBeenCalledTimes(1);
  });
});
