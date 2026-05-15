import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { heartbeatAttempt } from "@/features/Students/testSlice";

export const useAttemptHeartbeat = ({ attemptId, testId, onNotFound, onAlreadySubmitted }) => {
  const dispatch = useDispatch();
  const timeoutRef = useRef(null);
  const stoppedRef = useRef(false);
  const nextDelayRef = useRef(5000);

  useEffect(() => {
    stoppedRef.current = false;

    const run = async () => {
      if (!attemptId || stoppedRef.current) {
        return;
      }

      try {
        const response = await dispatch(
          heartbeatAttempt({
            attempt_id: attemptId,
            test_id: testId,
          })
        ).unwrap();

        if (response?.autoSubmitted) {
          onAlreadySubmitted?.();
          return;
        }

        nextDelayRef.current = 5000;
      } catch (error) {
        if (Number(error?.status) === 404) {
          onNotFound?.();
          return;
        }

        if (Number(error?.status) === 409) {
          onAlreadySubmitted?.();
          return;
        }

        if (Number(error?.status) === 429) {
          const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);
          nextDelayRef.current = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 10_000;
        } else {
          nextDelayRef.current = Math.min(20_000, nextDelayRef.current + 2000);
        }
      }

      timeoutRef.current = window.setTimeout(run, nextDelayRef.current);
    };

    timeoutRef.current = window.setTimeout(run, nextDelayRef.current);

    return () => {
      stoppedRef.current = true;
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [attemptId, dispatch, onAlreadySubmitted, onNotFound, testId]);
};
