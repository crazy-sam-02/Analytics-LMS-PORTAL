import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { heartbeatAttempt } from "@/features/Students/testSlice";

export const useAttemptHeartbeat = ({ attemptId, testId, onNotFound, onAlreadySubmitted }) => {
  const dispatch = useDispatch();
  const timeoutRef = useRef(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    const run = async () => {
      if (!attemptId || stoppedRef.current) {
        return;
      }

      try {
        await dispatch(
          heartbeatAttempt({
            attempt_id: attemptId,
            test_id: testId,
          })
        ).unwrap();
      } catch (error) {
        if (Number(error?.status) === 404) {
          onNotFound?.();
          return;
        }

        if (Number(error?.status) === 409) {
          onAlreadySubmitted?.();
          return;
        }
      }

      timeoutRef.current = window.setTimeout(run, 10000);
    };

    timeoutRef.current = window.setTimeout(run, 10000);

    return () => {
      stoppedRef.current = true;
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [attemptId, dispatch, onAlreadySubmitted, onNotFound, testId]);
};
