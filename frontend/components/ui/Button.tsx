import React from 'react';
import { Spinner } from '../Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  icon?: React.ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap rounded-md transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-50 select-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-indigo-600 text-white shadow-xs hover:bg-indigo-500 active:bg-indigo-700 ' +
    'dark:bg-indigo-500 dark:hover:bg-indigo-400',
  secondary:
    'bg-white text-gray-900 border border-gray-300 shadow-xs hover:bg-gray-50 active:bg-gray-100 ' +
    'dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800',
  ghost:
    'text-gray-700 hover:bg-gray-100 hover:text-gray-900 ' +
    'dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
  danger:
    'bg-red-600 text-white shadow-xs hover:bg-red-500 active:bg-red-700',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-sm',
};

/**
 * The app's one button. Variants follow the usual hierarchy: one primary
 * action per view, secondary for the rest, ghost for toolbar-like actions.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading = false, icon, className = '', children, disabled, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size="sm" className="text-current" /> : icon}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

export default Button;
