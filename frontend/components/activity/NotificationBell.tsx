import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useActivity } from '../../contexts/ActivityContext';
import { AppNotification, getNotifications, markNotificationsRead } from '../../services/activityApi';
import { timeAgo } from '../../utils/timeAgo';

/**
 * Header bell: notifications for runs that finished or failed, and work that
 * paused for a reason someone must fix. Opening it marks them read.
 */
const NotificationBell: React.FC = () => {
  const { unread, refresh, navigate } = useActivity();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await getNotifications();
      setItems(result.notifications);
      setError(null);
      if (result.unread > 0) {
        await markNotificationsRead();
        refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications.');
    }
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    load();
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, load]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-popover animate-fade-in dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
            Notifications
          </div>
          <div className="max-h-96 overflow-y-auto">
            {error && <p className="px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {!error && items === null && <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
            {items && items.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Nothing yet. You'll hear here when a pull finishes or something needs you.
              </p>
            )}
            {items && items.length > 0 && (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((item) => (
                  <li key={item.notification_id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (item.link) navigate(item.link);
                        setOpen(false);
                      }}
                      className="flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                          item.severity === 'warning' ? 'bg-amber-500' : 'bg-indigo-500'
                        } ${item.read ? 'opacity-30' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">{item.title}</span>
                        {item.body && (
                          <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">{item.body}</span>
                        )}
                        <span className="mt-1 block text-xs text-gray-400 dark:text-gray-500">
                          {timeAgo(item.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
