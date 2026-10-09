import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import Dialog from './Dialog';

const Harness = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        title="About this column"
        onClose={() => setOpen(false)}
        actions={
          <>
            <button>First</button>
            <button onClick={() => setOpen(false)}>Close</button>
          </>
        }
      >
        <p>What it counts.</p>
      </Dialog>
    </>
  );
};

describe('Dialog', () => {
  afterEach(cleanup);

  it('is announced by its title, keeps keyboard focus inside, and gives it back on close', () => {
    const view = render(<Harness />);
    const opener = view.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    expect(view.getByRole('dialog', { name: 'About this column' })).toBeTruthy();
    const first = view.getByRole('button', { name: 'First' });
    const close = view.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(first);

    // Tab from the last control comes round to the first, and Shift+Tab back.
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
