import React, { useEffect, useRef, useState } from 'react';
import { FieldHelp } from '../../constants/coreIdentifiers';

interface InfoTipProps {
  help: FieldHelp;
}

/**
 * A small "i" button that explains the field it sits next to.
 *
 * A popover rather than a modal: these sit beside form labels, and dimming the
 * whole screen to read one sentence loses the field you were filling in.
 */
const InfoTip: React.FC<InfoTipProps> = ({ help }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <span className="relative inline-flex align-middle" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={`What is ${help.title}?`}
        className="ml-1.5 w-4 h-4 inline-flex items-center justify-center rounded-full border border-gray-400 dark:border-gray-500 text-[10px] font-semibold leading-none text-gray-600 dark:text-gray-300 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900"
      >
        i
      </button>

      {isOpen && (
        <span
          role="tooltip"
          className="absolute left-0 top-6 z-30 w-72 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-lg text-left font-normal normal-case tracking-normal"
        >
          <span className="block text-sm font-semibold text-gray-900 dark:text-white mb-1">
            {help.title}
          </span>
          <span className="block text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {help.text}
          </span>
        </span>
      )}
    </span>
  );
};

export default InfoTip;
