import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearChangedAnswerIds, saveAttemptAnswers, setSaveStatus } from "@/features/Students/testSlice";

const localDraftKey = (attemptId) => `lms:attempt:draft:${attemptId}`;

const wait = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

export const useAttemptAutosave = () => {
  const dispatch = useDispatch();
  const debounceTimerRef = useRef(null);
  const isFlushingRef = useRef(false);

  const { attempt_id, test_id, answers, changed_answer_ids } = useSelector((state) => state.test);

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

  const removeDraftFromSession = useCallback(() => {
    if (!attempt_id) return;

    try {
      sessionStorage.removeItem(localDraftKey(attempt_id));
    } catch {
      // Ignore storage delete failures.
    }
  }, [attempt_id]);

  const flush = useCallback(async () => {
    if (!attempt_id || !test_id || !changedPayload.length || isFlushingRef.current) {
      return;
    }

    isFlushingRef.current = true;
    dispatch(setSaveStatus("saving"));

    const retryDelays = [1000, 2000, 4000];

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

          dispatch(clearChangedAnswerIds(changedPayload.map((item) => item.question_id)));
          dispatch(setSaveStatus("saved"));
          removeDraftFromSession();
          isFlushingRef.current = false;
          return;
        } catch (error) {
          lastError = error;
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
  }, [attempt_id, changedPayload, dispatch, removeDraftFromSession, test_id, writeDraftToSession]);

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

    debounceTimerRef.current = window.setTimeout(() => {
      flush();
    }, 2000);

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [attempt_id, changedPayload.length, flush]);

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
        ).unwrap().catch(() => null);
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
