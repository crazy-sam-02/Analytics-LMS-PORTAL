import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  fetchUnreadNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/features/Students/notificationsSlice";
import { sanitizeText } from "@/lib/security";

const resolvePathFromNotification = (item) => {
  const type = String(item?.type || "").toUpperCase();
  const metadata = item?.metadata || {};
  const attemptId = metadata?.attempt_id || metadata?.attemptId || metadata?.submission_id || metadata?.submissionId;
  const testId = metadata?.test_id || metadata?.testId;

  if (type === "TEST_UNLOCKED") {
    return testId ? `/tests/upcoming` : null;
  }

  if (type === "RESULT_PUBLISHED") {
    return attemptId ? `/results/${attemptId}` : null;
  }

  if (type === "EVENT_REGISTERED") {
    return "/events";
  }

  if (type === "ANNOUNCEMENT") {
    return "/events";
  }

  if (type === "VIOLATION_WARNING") {
    return attemptId ? `/test/${attemptId}` : null;
  }

  return "/tests/ongoing";
};

export default function NotificationBell() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, unreadCount, loading, loadingMore, hasMore, page } = useSelector((state) => state.notifications);

  useEffect(() => {
    dispatch(fetchUnreadNotifications({ page: 1 }));
  }, [dispatch]);

  const openNotification = (item) => {
    dispatch(markNotificationAsRead({ notificationId: item.id }));

    const nextPath = resolvePathFromNotification(item);
    if (!nextPath) {
      toast.error("Related content is no longer available.");
      return;
    }

    navigate(nextPath);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="relative grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm">
          <Bell className="size-5" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-90 p-0">
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <Button
              type="button"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => dispatch(markAllNotificationsAsRead())}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </div>
        </div>

        <div className="max-h-96 overflow-auto">
          {loading ? <p className="px-3 py-4 text-sm text-slate-500">Loading notifications...</p> : null}

          {!loading && items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No unread notifications.</p>
          ) : null}

          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
              onClick={() => openNotification(item)}
            >
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{sanitizeText(item.type || "Notification")}</p>
              <p className="mt-1 text-sm text-slate-700">{sanitizeText(item.message || "")}</p>
            </button>
          ))}

          {hasMore ? (
            <div className="p-2">
              <Button
                type="button"
                variant="outline"
                className="h-8 w-full text-xs"
                onClick={() => dispatch(fetchUnreadNotifications({ page: page + 1 }))}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
