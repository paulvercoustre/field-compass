import React from 'react';
import Button from './Button';
import Dialog from './Dialog';

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
 * Keyboard focus starts on Cancel, the safe choice.
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
}) => (
  <Dialog
    open={open}
    title={title}
    onClose={onCancel}
    busy={busy}
    actions={
      <>
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
      </>
    }
  >
    {children}
  </Dialog>
);

export default ConfirmDialog;
