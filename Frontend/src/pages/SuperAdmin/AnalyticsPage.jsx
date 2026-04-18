import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchSuperAnalytics } from "@/features/SuperAdmin/superAdminPanelSlice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AnalyticsPage() {
  const dispatch = useDispatch();
  const analytics = useSelector((state) => state.superAdminPanel.analytics);

  useEffect(() => {
    dispatch(fetchSuperAnalytics());
  }, [dispatch]);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Top Performing Colleges</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(analytics?.topPerformingColleges || []).map((item) => (
            <div key={item.collegeId} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="font-medium text-slate-800">{item.collegeName}</p>
              <p className="text-xs text-slate-500">Avg Score: {item.avgScore}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Top Students</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(analytics?.topStudents || []).map((item) => (
            <div key={item.studentId} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="font-medium text-slate-800">{item.studentName}</p>
              <p className="text-xs text-slate-500">{item.collegeName} • Avg Score: {item.avgScore}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Most Active Tests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(analytics?.mostActiveTests || []).map((item) => (
            <div key={item.testId} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="font-medium text-slate-800">{item.testName}</p>
              <p className="text-xs text-slate-500">Submissions: {item.submissions}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader><CardTitle>Violation Statistics</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(analytics?.violationStatistics || []).map((item) => (
            <div key={item.type} className="rounded-xl border border-slate-200 px-3 py-2">
              <p className="font-medium text-slate-800">{item.type}</p>
              <p className="text-xs text-slate-500">Count: {item.count}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
