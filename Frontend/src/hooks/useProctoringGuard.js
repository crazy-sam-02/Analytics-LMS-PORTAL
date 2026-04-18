import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";
import { incrementViolationCounter, reportAttemptViolation } from "@/features/Students/testSlice";
import { connectTestSocket } from "@/services/testSocket";

const toCounterType = (raw) => {
  const type = String(raw || "").toLowerCase();
  if (type.includes("tab")) return "tab_switch";
  if (type.includes("copy")) return "copy";
  if (type.includes("paste")) return "paste";
  if (type.includes("blur")) return "window_blur";
  return "window_blur";
};

export const useProctoringGuard = ({ attemptId, testId, enabled, threshold, fullscreenRequired, onThresholdExceeded }) => {
  const dispatch = useDispatch();
  const violationsTotal = useSelector((state) => state.test.violations.total);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const lockRef = useRef(false);

  const socket = useMemo(() => connectTestSocket(), []);

  useEffect(() => {
    if (!enabled || !attemptId || !testId) {
      return undefined;
    }

    const registerViolation = (type, metadata = {}) => {
      if (lockRef.current) {
        return;
      }

      lockRef.current = true;
      window.setTimeout(() => {
        lockRef.current = false;
      }, 250);

      const counterType = toCounterType(type);
      dispatch(incrementViolationCounter(counterType));

      dispatch(
        reportAttemptViolation({
          attempt_id: attemptId,
          test_id: testId,
          type,
          metadata,
        })
      );

      socket?.emit("violation", {
        attempt_id: attemptId,
        type,
        metadata,
      });

      toast.error(`Violation detected: ${type}`, {
        dismissible: false,
        duration: 3000,
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        registerViolation("tab_switch", { at: Date.now() });
      }
    };

    const onBlur = () => {
      registerViolation("window_blur", { at: Date.now() });
    };

    const onCopy = (event) => {
      event.preventDefault();
      registerViolation("copy", { at: Date.now() });
    };

    const onPaste = (event) => {
      event.preventDefault();
      registerViolation("paste", { at: Date.now() });
    };

    const onCut = (event) => {
      event.preventDefault();
      registerViolation("cut", { at: Date.now() });
    };

    const onContext = (event) => {
      event.preventDefault();
      registerViolation("right_click", { at: Date.now() });
    };

    const onKey = (event) => {
      if (event.key === "PrintScreen") {
        registerViolation("print_screen", { at: Date.now() });
      }
    };

    const requestFullscreen = async () => {
      const root = document.documentElement;
      if (document.fullscreenElement || !root.requestFullscreen) {
        return;
      }

      try {
        await root.requestFullscreen();
        setFullscreenBlocked(false);
      } catch {
        setFullscreenBlocked(true);
      }
    };

    const onFullScreenChange = () => {
      if (!fullscreenRequired) {
        return;
      }

      if (!document.fullscreenElement) {
        registerViolation("fullscreen_exit", { at: Date.now() });
        setFullscreenBlocked(true);
      }
    };

    if (fullscreenRequired) {
      requestFullscreen();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("cut", onCut);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullScreenChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullScreenChange);
    };
  }, [attemptId, dispatch, enabled, fullscreenRequired, socket, testId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (violationsTotal >= Math.max(1, Number(threshold || 3) - 1) && violationsTotal < Number(threshold || 3)) {
      toast.warning("One more violation will auto-submit your test.", {
        dismissible: false,
        duration: 3000,
      });
    }

    if (violationsTotal >= Number(threshold || 3)) {
      onThresholdExceeded?.();
    }
  }, [enabled, onThresholdExceeded, threshold, violationsTotal]);

  return {
    fullscreenBlocked,
    reEnterFullscreen: async () => {
      const root = document.documentElement;
      if (!root.requestFullscreen) {
        return;
      }

      try {
        await root.requestFullscreen();
        setFullscreenBlocked(false);
      } catch {
        setFullscreenBlocked(true);
      }
    },
  };
};
