import { useEffect, useRef, useState } from "react";

export const useAttemptTimer = ({ serverEndTime, onExpired }) => {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, Number(serverEndTime || 0) - Date.now()));
  const intervalRef = useRef(null);
  const expiryTriggeredRef = useRef(false);

  useEffect(() => {
    expiryTriggeredRef.current = false;
  }, [serverEndTime]);

  useEffect(() => {
    const end = Number(serverEndTime || 0);
    if (!end) {
      setRemainingMs(0);
      return undefined;
    }

    const tick = () => {
      const nextRemaining = Math.max(0, end - Date.now());
      setRemainingMs(nextRemaining);

      if (nextRemaining <= 0) {
        if (!expiryTriggeredRef.current) {
          expiryTriggeredRef.current = true;
          onExpired?.();
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    // Run once immediately, then every second
    tick();
    intervalRef.current = setInterval(tick, 1000);

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
