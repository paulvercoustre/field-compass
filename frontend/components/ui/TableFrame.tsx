import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * For a table's `<thead>`: it stays in view while the rows scroll under it,
 * with a hairline beneath so it reads apart from the row it covers.
 */
export const STICKY_HEAD =
  'sticky top-[var(--sticky-top,0px)] z-10 bg-gray-50 dark:bg-gray-900 [&_th]:shadow-[inset_0_-1px_0_theme(colors.gray.200)] dark:[&_th]:shadow-[inset_0_-1px_0_theme(colors.gray.800)]';

/**
 * Around a table whose header is STICKY_HEAD. When the table fits across, the
 * page scrolls it and the header sticks to the top of the page; `overflow:
 * clip` keeps the rounded corners without making the frame scroll. One too
 * wide for the screen scrolls inside the frame instead, both ways, a screen
 * high, so its header still has something to stick to.
 *
 * A sticky header stops at the scroller's padding; the page's is lifted off
 * (--sticky-top), so no row shows above the header.
 */
const TableFrame: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => {
  const frame = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = frame.current;
    const table = element?.querySelector('table');
    if (!element || !table || typeof ResizeObserver === 'undefined') return;
    let scroller = element.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      const tooWide = table.offsetWidth > element.clientWidth + 1;
      const padding = scroller && !tooWide ? parseFloat(getComputedStyle(scroller).paddingTop) || 0 : 0;
      element.style.setProperty('--sticky-top', `${-padding}px`);
      setWide(tooWide);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(table);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={frame}
      data-wide={wide || undefined}
      className={`${wide ? 'max-h-[calc(100dvh-8rem)] overflow-auto' : 'overflow-clip'} ${className}`}
    >
      {children}
    </div>
  );
};

export default TableFrame;
