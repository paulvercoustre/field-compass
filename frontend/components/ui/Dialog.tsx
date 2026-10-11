import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Something is under way (a delete, a save): the dialog stays open until it ends. */
  busy?: boolean;
  children: React.ReactNode;
  /** The buttons along the bottom. */
  actions?: React.ReactNode;
  /**
   * A long read on a phone: up from the bottom, as wide as the screen and
   * scrolling, the title left to the content's own heading (still announced).
   */
  sheet?: boolean;
}

/**
 * The app's dialog, over the dimmed page. Announced as a dialog by its title;
 * keyboard focus moves into it, stays inside while it is open, and goes back
 * where it was when it closes. Escape or a click outside closes it.
 */
const Dialog: React.FC<DialogProps> = ({ open, title, onClose, busy = false, children, actions, sheet = false }) => {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Read when a key is pressed, so the effect below runs once per opening.
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusable()[0] ?? panel.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (!latest.current.busy) latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, [open]);

  if (!open) return null;
  // At the root of the page, so it takes on nothing from where it was opened:
  // inside a table heading it inherited no-wrap, and its text ran out of the box.
  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex justify-center bg-gray-950/40 backdrop-blur-[2px] ${sheet ? 'items-end sm:items-center' : 'items-center'}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full border border-gray-200 bg-white shadow-popover outline-none animate-fade-in dark:border-gray-800 dark:bg-gray-900 ${
          sheet
            ? 'flex max-h-[92dvh] max-w-lg flex-col rounded-t-xl sm:mx-4 sm:rounded-xl'
            : 'mx-4 max-w-md rounded-xl p-6'
        }`}
      >
        <h2
          id={titleId}
          className={sheet ? 'sr-only' : 'mb-3 text-base font-semibold tracking-tight text-gray-900 dark:text-white'}
        >
          {title}
        </h2>
        <div
          className={sheet ? 'min-h-0 flex-1 overflow-y-auto' : 'space-y-2 text-sm text-gray-700 dark:text-gray-300'}
        >
          {children}
        </div>
        {actions && (
          <div
            className={`flex justify-end gap-3 ${sheet ? 'border-t border-gray-100 px-4 py-3 dark:border-gray-800' : 'mt-5'}`}
          >
            {actions}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default Dialog;
