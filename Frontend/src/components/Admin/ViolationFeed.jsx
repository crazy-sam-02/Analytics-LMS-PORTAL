import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ViolationFeed({ items }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader>
        <CardTitle className="text-base">Violation Feed</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">No violations yet.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id || `${item.studentId}-${item.at}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <p className="font-medium">{item.studentName || "Student"} -&gt; {item.type}</p>
                <p className="text-xs text-amber-700">{new Date(item.at || Date.now()).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
