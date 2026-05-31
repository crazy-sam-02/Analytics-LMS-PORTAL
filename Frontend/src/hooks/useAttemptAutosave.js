import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearSavedAnswerSnapshots, restoreDraftAnswers, saveAttemptAnswers, setSaveStatus } from "@/features/Students/testSlice";

const localDraftKey = (attemptId) => `lms:attempt:draft:${attemptId}`;

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

export const useAttemptAutosave = () => {
  const dispatch = useDispatch();
  const debounceTimerRef = useRef(null);
  const isFlushingRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const restoredAttemptRef = useRef(null);

  const { attempt_id, test_id, answers, changed_answer_ids, question_order } = useSelector((state) => state.test);

  const changedPayload = useMemo(() => {
    return changed_answer_ids
      .map((questionId) => {
        const answer = answers[questionId] || {};

        return {
          question_id: questionId,
          selected_option: answer.selected_option ?? null,
          selected_options: Array.isArray(answer.selected_options) ? answer.selected_options : [],
          answer_boolean: typeof answer.answer_boolean === "boolean" ? answer.answer_boolean : null,
          answer_text: typeof answer.answer_text === "string" ? answer.answer_text : "",
          marked_for_review: Boolean(answer.marked_for_review),
        };
      });
  }, [answers, changed_answer_ids]);

  const writeDraftToSession = useCallback((payload) => {
    if (!attempt_id) return;

    try {
      sessionStorage.setItem(localDraftKey(attempt_id), JSON.stringify(payload));
    } catch {
      // Ignore storage write failures.
    }
  }, [attempt_id]);

  const flush = useCallback(async () => {
    if (!attempt_id || !test_id || !changedPayload.length || isFlushingRef.current) {
      return;
    }

    if (Date.now() < cooldownUntilRef.current) {
      return;
    }

    writeDraftToSession(changedPayload);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      dispatch(setSaveStatus("error"));
      return;
    }

    isFlushingRef.current = true;
    dispatch(setSaveStatus("saving"));

    const retryDelays = [1500, 3000, 6000];

    try {
      let lastError = null;

      for (let index = 0; index <= retryDelays.length; index += 1) {
        try {
          await dispatch(
            saveAttemptAnswers({
              attempt_id,
              test_id,
              changedAnswers: changedPayload,
            })
          ).unwrap();

          dispatch(clearSavedAnswerSnapshots(changedPayload));
          dispatch(setSaveStatus("saved"));
          isFlushingRef.current = false;
          return;
        } catch (error) {
          lastError = error;
          if (Number(error?.status) === 429) {
            const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);
            const cooldownMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 10_000;
            cooldownUntilRef.current = Date.now() + cooldownMs;
          }

          if (index < retryDelays.length) {
            await wait(retryDelays[index]);
          }
        }
      }

      throw lastError || new Error("Autosave failed");
    } catch {
      writeDraftToSession(changedPayload);
      dispatch(setSaveStatus("error"));
      isFlushingRef.current = false;
    }
  }, [attempt_id, changedPayload, dispatch, test_id, writeDraftToSession]);

  useEffect(() => {
    if (!attempt_id || !test_id || restoredAttemptRef.current === attempt_id || question_order.length === 0) {
      return;
    }

    restoredAttemptRef.current = attempt_id;

    let parsed = [];

    try {
      const raw = sessionStorage.getItem(localDraftKey(attempt_id));
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      parsed = [];
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      dispatch(restoreDraftAnswers(parsed));
    }
  }, [attempt_id, dispatch, question_order.length, test_id]);

  useEffect(() => {
    if (!attempt_id) {
      return undefined;
    }

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    if (!changedPayload.length) {
      return undefined;
    }

    writeDraftToSession(changedPayload);

    debounceTimerRef.current = window.setTimeout(() => {
      flush();
    }, 2000);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [attempt_id, changedPayload, changedPayload.length, flush, writeDraftToSession]);

  useEffect(() => {
    if (!attempt_id || !test_id) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (changedPayload.length > 0) {
        flush();
      }
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [attempt_id, changedPayload.length, flush, test_id]);

  useEffect(() => {
    if (!attempt_id || !test_id) {
      return undefined;
    }

    const onlineHandler = async () => {
      let parsed = [];

      try {
        const raw = sessionStorage.getItem(localDraftKey(attempt_id));
        parsed = raw ? JSON.parse(raw) : [];
      } catch {
        parsed = [];
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        await dispatch(
          saveAttemptAnswers({
            attempt_id,
            test_id,
            changedAnswers: parsed,
          })
        ).unwrap()
          .then(() => {
            dispatch(clearSavedAnswerSnapshots(parsed));
          })
          .catch(() => null);
      }

      flush();
    };

    window.addEventListener("online", onlineHandler);
    return () => window.removeEventListener("online", onlineHandler);
  }, [attempt_id, dispatch, flush, test_id]);

  return {
    flushPendingSaves: flush,
  };
};
