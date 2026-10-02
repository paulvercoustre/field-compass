import { RulePart } from '../../types';

const OPERATOR_TEXT: Record<string, string> = {
  '==': '=',
  '!=': '≠',
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  '%in%': 'is one of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const formatValue = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === '') return '""';
  return Number.isFinite(Number(trimmed)) ? trimmed : `"${trimmed}"`;
};

/**
 * A rule's conditions as one readable line, e.g. `hh_size > 15 AND consent = "no"`.
 * Variables appear by name; static values are quoted unless numeric.
 */
export const describeConditions = (parts: RulePart[]): string =>
  parts
    .map((part) => {
      if ('joiner' in part) return part.joiner === '&' ? 'AND' : 'OR';
      if (!part.variable) return '';
      const op = OPERATOR_TEXT[part.operator] ?? part.operator;
      if (part.operator === 'is_empty' || part.operator === 'is_not_empty') return `${part.variable} ${op}`;
      const value = part.valueType === 'variable' ? part.value : formatValue(part.value);
      return `${part.variable} ${op} ${value}`;
    })
    .filter(Boolean)
    .join(' ');
