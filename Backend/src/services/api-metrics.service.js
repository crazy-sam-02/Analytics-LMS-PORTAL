const MAX_ENTRIES = 5000;

const metrics = [];

const prune = () => {
  if (metrics.length <= MAX_ENTRIES) return;
  metrics.splice(0, metrics.length - MAX_ENTRIES);
};

const recordApiMetric = ({ durationMs, statusCode }) => {
  metrics.push({
    ts: Date.now(),
    durationMs,
    statusCode,
  });
  prune();
};

const getApiMetricsSnapshot = () => {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  const recentMinute = metrics.filter((item) => item.ts >= oneMinuteAgo);
  const recentWindow = metrics.filter((item) => item.ts >= fiveMinutesAgo);

  const avgResponseMs = recentWindow.length > 0
    ? recentWindow.reduce((sum, item) => sum + item.durationMs, 0) / recentWindow.length
    : 0;

  const errors = recentWindow.filter((item) => item.statusCode >= 500).length;
  const errorRatePercent = recentWindow.length > 0 ? (errors / recentWindow.length) * 100 : 0;

  return {
    avgResponseMs: Number(avgResponseMs.toFixed(2)),
    errorRatePercent: Number(errorRatePercent.toFixed(2)),
    requestsPerMinute: recentMinute.length,
  };
};

module.exports = {
  recordApiMetric,
  getApiMetricsSnapshot,
};
