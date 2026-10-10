import React from 'react';

const BAR = 5;
const GAP = 2;
const HEIGHT = 20;

export interface SparkBar {
  /** A share, 0 to 100; null for a day with nothing to share out. */
  share: number | null;
  /** What hovering the bar says: "14 Sep: 3 of 8 (38%)". */
  title: string;
}

/**
 * A share per day as tiny bars, scaled to the row's highest day so its trend
 * shows. A day with none is a grey stub; a day with no submissions, a gap.
 */
const Sparkline: React.FC<{ bars: SparkBar[]; label: string }> = ({ bars, label }) => {
  const max = Math.max(1, ...bars.map((b) => b.share ?? 0));
  return (
    <svg
      width={bars.length * (BAR + GAP) - GAP}
      height={HEIGHT}
      role="img"
      aria-label={label}
      className="block overflow-visible"
    >
      {bars.map((bar, i) => {
        const height = bar.share === null ? 0 : bar.share ? Math.max(3, (bar.share / max) * HEIGHT) : 1;
        // The whole column answers a hover, not just the bar: a stub is 1px tall.
        return (
          <g key={i}>
            <title>{bar.title}</title>
            <rect x={i * (BAR + GAP)} y={0} width={BAR + GAP} height={HEIGHT} fill="transparent" />
            {bar.share !== null && (
              <rect
                x={i * (BAR + GAP)}
                y={HEIGHT - height}
                width={BAR}
                height={height}
                rx={1}
                className={bar.share ? 'fill-amber-600 dark:fill-amber-500' : 'fill-gray-300 dark:fill-gray-700'}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default Sparkline;
