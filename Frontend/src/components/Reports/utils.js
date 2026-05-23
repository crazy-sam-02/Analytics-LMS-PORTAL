export const clampPercent = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
};

export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export const scoreColorClass = (score) => {
  const value = clampPercent(score);
  if (value >= 75) return "text-green-500";
  if (value >= 50) return "text-yellow-500";
  return "text-red-500";
};

export const formatPercent = (value) => {
  const number = clampPercent(value);
  return `${number.toFixed(1)}%`;
};

export const formatDateLabel = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "-");
  return date.toLocaleDateString();
};

export const toQueryString = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "" || value === "all") return;
    query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
};
