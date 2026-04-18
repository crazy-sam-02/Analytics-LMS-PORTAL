import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, BarChart, Bar } from "recharts";
import StatCard from "@/components/common/StatCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminApi } from "@/services/api";
import { connectTestSocket } from "@/services/testSocket";

const lineConfig = {
  count: {
    label: "Participation",
    color: "var(--success)",
  },
};

const barConfig = {
  averageScore: {
    label: "Avg Score",
    color: "var(--primary)",
  },
};

function mapStatusVariant(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "ended") {
    return "ended";
  }
  if (normalized === "active") {
    return "active";
  }
  return "pending";
}

export default function AdminDashboardPage() {
  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: adminApi.getDashboard,
    staleTime: 300000,
  });

  useEffect(() => {
    const socket = connectTestSocket();
    const refreshDashboard = () => {
      refetch();
    };

    socket.on("test_status_change", refreshDashboard);

    return () => {
      socket.off("test_status_change", refreshDashboard);
    };
  }, [refetch]);

  const cards = data?.cards || {};
  const submissions = data?.recentSubmissions || [];
  const activity = data?.recentActivity || [];
  const trend = data?.charts?.testParticipationTrend || [];
  const avgScore = data?.charts?.averageScorePerTest?.slice(0, 8) || [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Students" value={cards.totalStudents || 0} />
        <StatCard title="Total Tests Created" value={cards.totalTestsCreated || 0} />
        <StatCard title="Active Tests" value={cards.activeTests || 0} />
        <StatCard title="Upcoming Tests" value={cards.upcomingTests || 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>Exam Participation Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={lineConfig} className="h-72 w-full">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="count" stroke="var(--color-count)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>Average Score Per Test</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={barConfig} className="h-72 w-full">
              <BarChart data={avgScore}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="testName" hide />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="averageScore" fill="var(--color-averageScore)" radius={8} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Recent Exam Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-text-secondary">Loading dashboard...</p> : null}
          {!isLoading && submissions.length === 0 ? <p className="text-sm text-text-secondary">No submissions yet.</p> : null}
          {submissions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Exam</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((item) => {
                  const status = item.test?.status || "pending";
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium text-text-primary">{item.user?.fullName || "-"}</div>
                        <div className="text-xs text-text-secondary">{item.user?.studentId || "-"}</div>
                      </TableCell>
                      <TableCell>{item.test?.title || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={mapStatusVariant(status)}>{status}</Badge>
                      </TableCell>
                      <TableCell>{item.score ?? "-"}</TableCell>
                      <TableCell>{item.accuracy != null ? `${item.accuracy}%` : "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Recent Admin Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!isLoading && activity.length === 0 ? <p className="text-sm text-text-secondary">No activity yet.</p> : null}
          {activity.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
              <div>
                <p className="font-medium text-text-primary">{item.action}</p>
                <p className="text-xs text-text-secondary">
                  {item.admin?.fullName || item.admin?.email || "System"} • {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              {item.test?.id ? (
                <Link to="/admin/tests" className="text-xs font-medium text-primary hover:text-primary-dark">
                  {item.test?.title || "View Test"}
                </Link>
              ) : (
                <span className="text-xs text-text-secondary">No target</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
