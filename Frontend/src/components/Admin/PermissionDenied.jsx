export default function PermissionDenied({ action = "perform this action" }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      You no longer have permission to {action}. If this seems incorrect, contact a super admin.
    </div>
  );
}
