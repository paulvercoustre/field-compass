import React from 'react';

const BAR = 5;
const GAP = 2;
const HEIGHT = 20;

/** A count per day as tiny bars; days with none show as a stub, so the days stay visible. */
const Sparkline: React.FC<{ values: number[]; label: string }> = ({ values, label }) => {
  const max = Math.max(1, ...values);
  return (
    <svg
      width={values.length * (BAR + GAP) - GAP}
      height={HEIGHT}
      role="img"
      aria-label={label}
      className="block overflow-visible"
    >
      <title>{label}</title>
      {values.map((value, i) => {
        const height = value ? Math.max(3, (value / max) * HEIGHT) : 1;
        return (
          <rect
            key={i}
            x={i * (BAR + GAP)}
            y={HEIGHT - height}
            width={BAR}
            height={height}
            rx={1}
            className={value ? 'fill-amber-600 dark:fill-amber-500' : 'fill-gray-300 dark:fill-gray-700'}
          />
        );
      })}
    </svg>
  );
};

export default Sparkline;
