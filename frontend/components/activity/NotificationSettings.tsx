import React, { useState } from 'react';
import { BROWSER_NOTIFICATIONS_KEY } from '../../contexts/ActivityContext';

const readSetting = (): boolean => {
  try {
    return localStorage.getItem(BROWSER_NOTIFICATIONS_KEY) === 'on';
  } catch {
    return false;
  }
};

/**
 * Account Settings › Notifications. In-app notifications are always on; the
 * browser ones are opt-in, per browser, because the permission is too.
 */
const NotificationSettings: React.FC = () => {
  const supported = typeof Notification !== 'undefined';
  const [enabled, setEnabled] = useState(readSetting);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  );

  const toggle = async (on: boolean) => {
    if (on && supported && Notification.permission === 'default') {
      setPermission(await Notification.requestPermission());
    }
    try {
      localStorage.setItem(BROWSER_NOTIFICATIONS_KEY, on ? 'on' : 'off');
    } catch {
      // Private windows can refuse storage; the switch then lasts this visit.
    }
    setEnabled(on);
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-card dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Notifications</h2>
      <p className="mb-5 mt-1 text-sm text-gray-500 dark:text-gray-400">
        The bell at the top of every page tells you when a pull and its checks finish, when a pull fails, and when work
        stops for a reason someone must fix.
      </p>
      <div className="flex items-start gap-3">
        <input
          id="browser-notifications"
          type="checkbox"
          checked={enabled && permission === 'granted'}
          disabled={!supported || permission === 'denied'}
          onChange={(event) => toggle(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600 dark:border-gray-600 dark:bg-gray-700"
        />
        <div>
          <label htmlFor="browser-notifications" className="text-sm font-medium text-gray-900 dark:text-white">
            Also tell me in the browser
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            When a pull you started finishes while Field Compass is in another tab. This browser only.
          </p>
          {permission === 'denied' && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              This browser blocks notifications from Field Compass. Allow them in the browser's site settings first.
            </p>
          )}
          {!supported && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">This browser can't show notifications.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default NotificationSettings;
