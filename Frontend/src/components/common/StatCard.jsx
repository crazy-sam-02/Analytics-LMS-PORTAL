import { Card, CardContent } from "@/components/ui/card";

export default function StatCard({ title, value, suffix }) {
  return (
    <Card className="rounded-xl border-border bg-card shadow-sm">
      <CardContent className="px-4 py-4">
        <p className="text-sm text-text-secondary">{title}</p>
        <p className="mt-2 text-3xl font-bold text-text-primary">
          {value}
          {suffix ? <span className="text-base font-medium text-text-secondary"> {suffix}</span> : null}
        </p>
      </CardContent>
    </Card>
  );
}
