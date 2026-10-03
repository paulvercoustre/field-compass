import React, { useEffect } from 'react';
import Button from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red for actions that remove or stop something; indigo otherwise. */
  tone?: 'danger' | 'primary';
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The app's confirmation dialog, styled like "Delete survey": a title, what
 * will happen, grey Cancel and the action. Never the browser's confirm().
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="mx-4 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-popover animate-fade-in dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 id="confirm-dialog-title" className="mb-3 text-base font-semibold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h2>
        <div className="mb-5 space-y-2 text-sm text-gray-700 dark:text-gray-300">{children}</div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
