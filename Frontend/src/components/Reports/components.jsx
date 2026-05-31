import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { CHART_COLORS, clampPercent, scoreColorClass } from "@/components/Reports/utils";

const AXIS_TICK = { fontSize: 11, fill: "var(--text-secondary)" };

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-semibold text-text-primary">{label}</p> : null}
      {payload.map((point, index) => (
        <div key={`${point.name}-${index}`} className="flex items-center gap-2 text-text-secondary">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: point.color }} />
          <span>{point.name}:</span>
          <span className="font-semibold text-text-primary">{typeof point.value === "number" ? clampPercent(point.value).toFixed(2) : point.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ title, action, height = "h-[220px]", children, footer }) {
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {action ? (
          <button type="button" onClick={action.onClick} className="text-xs font-medium text-chart-1 transition-opacity hover:opacity-70">
            {action.label}
          </button>
        ) : null}
      </div>
      <div className={`${height} min-h-0 w-full min-w-0`}>{children}</div>
      {footer ? <p className="mt-2 text-xs text-text-secondary">{footer}</p> : null}
    </article>
  );
}

export function KpiCard({ label, value, sub, flag, flagLabel }) {
  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-card p-5 ${flag ? "border-red-500/50" : "border-border"}`}>
      {flag ? <div className="absolute inset-x-0 top-0 h-0.5 bg-red-500" /> : null}
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">{label}</p>
      <p className={`text-3xl leading-none font-bold tabular-nums ${flag ? "text-red-500" : "text-text-primary"}`}>{value ?? "-"}</p>
      {sub || (flag && flagLabel) ? <p className={`mt-1.5 text-xs ${flag ? "text-red-400" : "text-text-secondary"}`}>{flag && flagLabel ? flagLabel : sub}</p> : null}
    </article>
  );
}

export function AbsentStudentsCard({ title, subtitle, students = [], count }) {
  const rows = Array.isArray(students) ? students : [];
  const total = Number.isFinite(Number(count)) ? Number(count) : rows.length;

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        <div className="rounded-xl border border-border bg-background px-3 py-2 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Not Attended</p>
          <p className="text-lg font-bold text-text-primary">{total}</p>
        </div>
      </div>

      {rows.length ? (
        <div className="mt-4 max-h-60 space-y-2 overflow-y-auto pr-1">
          {rows.map((student, index) => (
            <div
              key={student.studentId || student.id || `${student.name || "student"}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-text-primary">{student.name || "-"}</p>
                <p className="text-xs text-text-secondary">{student.rollNo || student.studentId || "-"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {student.department ? <StatusBadge label={student.department} variant="info" /> : null}
                {student.batch ? <StatusBadge label={student.batch} variant="default" /> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-secondary">All students attended this test in the current scope.</p>
      )}
    </article>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex h-full min-h-45 flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background">
        <svg className="h-5 w-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {description ? <p className="max-w-xs text-xs text-text-secondary">{description}</p> : null}
      {action ? (
        <button type="button" onClick={action.onClick} className="mt-1 rounded-lg border border-border bg-background px-4 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-card">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export function ScoreBadge({ score }) {
  return <span className={`font-semibold tabular-nums ${scoreColorClass(score)}`}>{score != null ? `${clampPercent(score).toFixed(2)}%` : "-"}</span>;
}

export function StatusBadge({ label, variant = "default" }) {
  const variants = {
    success: "bg-green-500/10 text-green-500",
    warning: "bg-yellow-500/10 text-yellow-500",
    danger: "bg-red-500/10 text-red-500",
    info: "bg-chart-1/10 text-chart-1",
    default: "bg-muted text-text-secondary",
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${variants[variant] || variants.default}`}>{label}</span>;
}

export function Th({ children, sortKey, sortState, onSort }) {
  const active = sortState?.key === sortKey;
  const asc = sortState?.dir === "asc";
  return (
    <th
      onClick={() => onSort?.(sortKey)}
      className={`select-none whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-widest text-text-secondary ${onSort ? "cursor-pointer hover:text-text-primary" : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {onSort ? <span className={`transition-opacity ${active ? "opacity-100" : "opacity-30"}`}>{active && !asc ? "↑" : "↓"}</span> : null}
      </span>
    </th>
  );
}

export function ViolationBadge({ count }) {
  const value = Number(count || 0);
  if (value === 0) return <StatusBadge label="Clean" variant="success" />;
  if (value <= 2) return <StatusBadge label={`${value} warnings`} variant="warning" />;
  return <StatusBadge label={`${value} violations`} variant="danger" />;
}

export function AreaTrendChart({ data, xKey = "month", dataKey = "score", name = "Avg Score", refValue, refLabel, color = "var(--chart-1)" }) {
  if (!data?.length) return <EmptyState title="No trend data" description="Scores will appear here once tests are submitted." />;
  if (data.length === 1) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-2xl font-bold tabular-nums text-text-primary">{clampPercent(data[0][dataKey]).toFixed(1)}%</p>
        <p className="text-xs text-text-secondary">Trend needs 2+ tests</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="10%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <Tooltip content={<ChartTooltip />} />
        {refValue != null ? (
          <ReferenceLine
            y={clampPercent(refValue)}
            stroke="var(--text-secondary)"
            strokeDasharray="4 3"
            strokeOpacity={0.5}
            label={{ value: refLabel || `Avg ${clampPercent(refValue).toFixed(1)}%`, fontSize: 10, fill: "var(--text-secondary)", position: "right" }}
          />
        ) : null}
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#grad-${dataKey})`}
          dot={{ r: 3, fill: color }}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LineTrendChart({ data, xKey = "month", dataKey = "score", name = "Avg Score", color = "var(--chart-2)" }) {
  if (!data?.length) return <EmptyState title="No trend data" description="Scores will appear after at least one submission." />;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
        <Tooltip content={<ChartTooltip />} />
        <Line
          type="linear"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 4, fill: color, strokeWidth: 0 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GroupedBarChart({ data, series = [], xKey = "department", highlightCategory }) {
  if (!data?.length) return <EmptyState title="No comparison data" />;

  const rows = Array.isArray(data) ? data : [];
  const s = Array.isArray(series) && series.length ? series : [{ key: "avgScore", label: "Avg Score" }, { key: "passRate", label: "Pass Rate" }];

  const colorClasses = ["bg-blue-600", "bg-green-500", "bg-indigo-500", "bg-yellow-400", "bg-red-500"];

  const toPct = (v) => {
    if (v == null || Number.isNaN(Number(v))) return 0;
    const n = Number(v);
    return clampPercent(n <= 1 ? n * 100 : n);
  };

  const all = rows.flatMap((r) => s.map((ser) => toPct(r[ser.key])));
  const max = Math.max(1, ...all);

  return (
    <div className="h-full w-full">
      <div className="mb-3 flex items-center gap-4">
        {s.map((ser, idx) => (
          <div key={ser.key} className="flex items-center gap-2 text-xs text-text-secondary">
            <span className={`inline-block h-2 w-2 rounded-sm ${colorClasses[idx % colorClasses.length]}`} />
            <span>{ser.label}</span>
          </div>
        ))}
      </div>

      <div className="h-full">
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row[xKey] || row.departmentId} className="flex items-start gap-3">
              <div className="w-36 text-sm font-medium text-text-primary truncate">{row[xKey]}</div>
              <div className="flex-1 space-y-1">
                {s.map((ser, idx) => {
                  const value = toPct(row[ser.key]);
                  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
                  const color = colorClasses[idx % colorClasses.length];
                  return (
                    <div key={ser.key} className="flex items-center gap-3">
                      <div className="w-28 text-xs text-text-secondary">{ser.label}</div>
                      <div className="flex-1 rounded bg-border h-3 overflow-hidden">
                        <div className={`${color} h-3`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-12 text-right text-xs text-text-secondary">{value ? `${Math.round(value)}%` : "-"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HorizontalBarChart({ data, dataKey = "score", labelKey = "subject", height = "h-[180px]" }) {
  if (!data?.length) return <EmptyState title="No topic data" />;
  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} />
          <YAxis type="category" dataKey={labelKey} axisLine={false} tickLine={false} tick={AXIS_TICK} width={80} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey={dataKey} name="Score" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {data.map((entry, index) => {
              const score = clampPercent(entry[dataKey]);
              const fill = score >= 75 ? "var(--chart-2)" : score >= 50 ? "var(--chart-4)" : "var(--chart-5)";
              return <Cell key={`${entry[labelKey]}-${index}`} fill={fill} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TopicRadarChart({ data, labelKey = "subject", dataKey = "score", color = "var(--chart-1)" }) {
  if (!data?.length) return <EmptyState title="No topic data" />;
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <RadarChart data={data} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey={labelKey} tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar name="Score" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
        <Tooltip content={<ChartTooltip />} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function TopicPieChart({ data, labelKey = "subject", dataKey = "score" }) {
  const rows = Array.isArray(data)
    ? data
        .map((item, index) => ({
          ...item,
          [labelKey]: item?.[labelKey] || item?.topic || item?.subject || `Topic ${index + 1}`,
          [dataKey]: clampPercent(item?.[dataKey]),
        }))
        .filter((item) => Number(item[dataKey]) > 0)
    : [];

  if (!rows.length) return <EmptyState title="No topic data" />;

  const average = rows.reduce((sum, item) => sum + clampPercent(item[dataKey]), 0) / rows.length;

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <PieChart>
        <Pie
          data={rows}
          dataKey={dataKey}
          nameKey={labelKey}
          cx="50%"
          cy="50%"
          innerRadius="42%"
          outerRadius="74%"
          paddingAngle={1}
          minAngle={4}
          isAnimationActive={false}
        >
          {rows.map((item, index) => (
            <Cell key={`${item[labelKey]}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-text-primary" style={{ fontSize: 18, fontWeight: 700 }}>
          {average.toFixed(1)}%
        </text>
        <text x="50%" y="50%" dy="18" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 10, fill: "var(--text-secondary)" }}>
          avg
        </text>
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
                <strong className="text-text-primary">{payload[0].payload?.[labelKey]}</strong>
                <span className="ml-2 text-text-secondary">{clampPercent(payload[0].payload?.[dataKey]).toFixed(1)}%</span>
              </div>
            ) : null
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ScoreDonutChart({ data, total }) {
  if (!data?.length) return <EmptyState title="No distribution data" />;
  const chartData = data.map((item) => ({ ...item, chartValue: Number(item.count || 0) === 0 ? 0.0001 : Number(item.count || 0) }));

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <PieChart>
        <Pie data={chartData} dataKey="chartValue" nameKey="range" cx="50%" cy="50%" innerRadius="45%" outerRadius="75%" paddingAngle={1} minAngle={2} isAnimationActive={false}>
          {chartData.map((item, index) => (
            <Cell key={`${item.range}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} opacity={Number(item.count || 0) === 0 ? 0.25 : 1} />
          ))}
        </Pie>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-text-primary" style={{ fontSize: 18, fontWeight: 700 }}>
          {Number(total || 0)}
        </text>
        <text x="50%" y="50%" dy="18" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 10, fill: "var(--text-secondary)" }}>
          students
        </text>
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs">
                <strong className="text-text-primary">{payload[0].payload?.range}</strong>
                <span className="ml-2 text-text-secondary">{payload[0].payload?.count || 0} students</span>
              </div>
            ) : null
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ExportButton({ exportState, onExport, onDownload, disabled, disabledReason }) {
  const { status, progress, downloadUrl, expiresAt } = exportState || {};

  const isExpired = expiresAt && new Date(expiresAt) < new Date();
  const nearExpiry = expiresAt && !isExpired && new Date(expiresAt).getTime() - Date.now() < 60 * 1000;

  if (status === "complete" && downloadUrl && !isExpired) {
    return (
      <div className="flex items-center gap-2">
        {nearExpiry ? <span className="text-xs text-yellow-500">Link expires soon</span> : null}
        <button
          type="button"
          onClick={onDownload}
          disabled={disabled}
          title={disabledReason || ""}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-500 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Download
        </button>
      </div>
    );
  }

  if (status === "loading" || status === "polling") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-secondary"
      >
        <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        {progress ? `Generating ${Math.round(progress)}%` : "Generating..."}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled}
      title={disabledReason || ""}
      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      {status === "failed" ? "Retry Export" : "Export Report"}
    </button>
  );
}

export function StudentIdentityCard({ student, stats }) {
  if (!student) return null;
  const percentile = Number(stats?.percentile || 0);
  const percentileClass =
    percentile >= 90 ? "text-green-500" : percentile >= 70 ? "text-chart-1" : percentile >= 50 ? "text-yellow-500" : "text-red-500";

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-xl font-bold text-chart-1">
          {String(student.name || "?")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-text-primary">{student.name}</p>
          <p className="text-xs text-text-secondary">{student.studentId || "-"} · {student.department || "-"} · {student.batch || "-"}</p>
        </div>
        <div className="flex flex-wrap gap-8">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-text-primary">{stats.avg != null ? `${Number(stats.avg).toFixed(1)}%` : "-"}</p>
            <p className="text-[11px] text-text-secondary">avg score</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold tabular-nums ${percentileClass}`} title={stats.totalSubmissions < 5 ? "Needs 5+ submissions" : "Percentile"}>
              {stats.totalSubmissions < 5 ? "N/A" : `${Math.round(percentile)}%`}
            </p>
            <p className="text-[11px] text-text-secondary">percentile</p>
            {stats.totalSubmissions < 5 ? <p className="text-[10px] text-text-secondary">Needs 5+ submissions</p> : null}
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-text-primary">#{stats.rank || "-"}</p>
            <p className="text-[11px] text-text-secondary">college rank</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold tabular-nums ${stats.violations > 2 ? "text-red-500" : stats.violations > 0 ? "text-yellow-500" : "text-green-500"}`}>
              {Number(stats.violations || 0)}
            </p>
            <p className="text-[11px] text-text-secondary">violations</p>
          </div>
        </div>
      </div>
    </article>
  );
}
