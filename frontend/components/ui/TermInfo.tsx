import React, { useState } from 'react';
import Dialog from './Dialog';
import Button from './Button';
import type { Term } from '../../utils/glossary';

/** The ⓘ beside a named count: opens what it means, in the glossary's words. */
const TermInfo: React.FC<{ term: Term }> = ({ term }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`What “${term.name}” means`}
        className="rounded font-bold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        <span aria-hidden="true">&#9432;</span>
      </button>
      <Dialog
        open={open}
        title={term.name}
        onClose={() => setOpen(false)}
        actions={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <p>{term.definition}</p>
      </Dialog>
    </>
  );
};

export default TermInfo;
