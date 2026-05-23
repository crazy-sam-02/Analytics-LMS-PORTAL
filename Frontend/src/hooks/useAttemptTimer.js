import { useEffect, useRef, useState } from "react";

export const useAttemptTimer = ({ serverEndTime, onExpired }) => {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, Number(serverEndTime || 0) - Date.now()));
  const intervalRef = useRef(null);
  const expiryTriggeredRef = useRef(false);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    expiryTriggeredRef.current = false;
  }, [serverEndTime]);

  useEffect(() => {
    const end = Number(serverEndTime || 0);
    if (!end) {
      setRemainingMs((current) => (current === 0 ? current : 0));
      return undefined;
    }

    const tick = () => {
      const nextRemaining = Math.max(0, end - Date.now());
      setRemainingMs((current) => (current === nextRemaining ? current : nextRemaining));

      if (nextRemaining <= 0) {
        if (!expiryTriggeredRef.current) {
          expiryTriggeredRef.current = true;
          onExpiredRef.current?.();
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    tick();
    intervalRef.current = setInterval(tick, Math.min(1000, Math.max(25, end - Date.now())));

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [serverEndTime]);

  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
};
