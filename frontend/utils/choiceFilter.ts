/**
 * Which options of a list a respondent was offered, from the question's
 * XLSForm `choice_filter`: `province=${province}`, `selected(${crops}, name)`,
 * `not(selected(${first}, name)) and type='food'`, and the like.
 *
 * The filter is XPath, evaluated once per option with the option's own
 * columns in scope and `${…}` read from the submission's answers. Enough of
 * XPath is understood for the filters forms use: comparisons, and, or,
 * parentheses, and selected, not, starts-with, contains, string-length,
 * count-selected, string, number, true and false. Anything else, or a
 * column no option has (a form saved before Field Compass kept them),
 * means the answer is "can't tell" rather than a guess.
 */

export type Choice = { name: string } & Record<string, unknown>;

/** Why the offered options could not be worked out. */
export type FilterUnknown = 'columns-missing' | 'unsupported';

export type FilterResult = { offered: Set<string> } | { unknown: FilterUnknown };

type Value = string | number | boolean;

type Node =
  | { kind: 'literal'; value: Value }
  | { kind: 'ref'; name: string }
  | { kind: 'column'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'binary'; op: string; left: Node; right: Node };

class Unsupported extends Error {}
class MissingColumn extends Error {}

const TOKEN =
  /\s*(?:(\$\{[^}\s]+\})|('[^']*'|"[^"]*")|(\d+(?:\.\d+)?)|(!=|<=|>=|=|<|>|\(|\)|,)|([A-Za-z_][\w.:-]*)|(\S))/y;

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.length) {
    const match = TOKEN.exec(expression);
    if (!match) break;
    if (match[6] !== undefined) throw new Unsupported(match[6]);
    const token = match.slice(1, 6).find((t) => t !== undefined);
    if (token !== undefined) tokens.push(token);
  }
  return tokens;
}

function parse(expression: string): Node {
  const tokens = tokenize(expression);
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected?: string) => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected)) throw new Unsupported(expected ?? 'end');
    return token;
  };

  const primary = (): Node => {
    const token = take();
    if (token === '(') {
      const inner = or();
      take(')');
      return inner;
    }
    if (token.startsWith('${')) return { kind: 'ref', name: token.slice(2, -1) };
    if (token.startsWith("'") || token.startsWith('"')) return { kind: 'literal', value: token.slice(1, -1) };
    if (/^\d/.test(token)) return { kind: 'literal', value: Number(token) };
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === '(') {
        take('(');
        const args: Node[] = [];
        if (peek() !== ')') {
          args.push(or());
          while (peek() === ',') {
            take(',');
            args.push(or());
          }
        }
        take(')');
        return { kind: 'call', name: token, args };
      }
      return { kind: 'column', name: token };
    }
    throw new Unsupported(token);
  };
  const comparison = (): Node => {
    const left = primary();
    const op = peek();
    if (op && ['=', '!=', '<', '<=', '>', '>='].includes(op)) {
      take();
      return { kind: 'binary', op, left, right: primary() };
    }
    return left;
  };
  const and = (): Node => {
    let node = comparison();
    while (peek() === 'and') {
      take();
      node = { kind: 'binary', op: 'and', left: node, right: comparison() };
    }
    return node;
  };
  const or = (): Node => {
    let node = and();
    while (peek() === 'or') {
      take();
      node = { kind: 'binary', op: 'or', left: node, right: and() };
    }
    return node;
  };

  const tree = or();
  if (at < tokens.length) throw new Unsupported(tokens[at]);
  return tree;
}

const truthy = (value: Value): boolean =>
  typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 && !Number.isNaN(value) : value !== '';

const asNumber = (value: Value): number => (typeof value === 'number' ? value : Number(value));

const numeric = (value: Value): boolean =>
  typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));

function compare(op: string, left: Value, right: Value): boolean {
  if (op === '=' || op === '!=') {
    const same = numeric(left) && numeric(right) ? asNumber(left) === asNumber(right) : String(left) === String(right);
    return op === '=' ? same : !same;
  }
  const a = asNumber(left);
  const b = asNumber(right);
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  return a >= b;
}

const words = (value: Value): string[] => String(value).split(/\s+/).filter(Boolean);

function evaluate(node: Node, choice: Choice, answer: (name: string) => unknown, columns: Set<string>): Value {
  const run = (n: Node) => evaluate(n, choice, answer, columns);
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'ref': {
      const value = answer(node.name);
      return value === undefined || value === null ? '' : typeof value === 'number' ? value : String(value);
    }
    case 'column':
      if (node.name === 'name') return choice.name;
      if (!columns.has(node.name)) throw new MissingColumn(node.name);
      return choice[node.name] === undefined || choice[node.name] === null ? '' : String(choice[node.name]);
    case 'binary':
      if (node.op === 'and') return truthy(run(node.left)) && truthy(run(node.right));
      if (node.op === 'or') return truthy(run(node.left)) || truthy(run(node.right));
      return compare(node.op, run(node.left), run(node.right));
    case 'call': {
      const args = node.args.map(run);
      switch (node.name) {
        case 'selected':
          return words(args[0] ?? '').includes(String(args[1] ?? ''));
        case 'not':
          return !truthy(args[0] ?? false);
        case 'starts-with':
          return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
        case 'contains':
          return String(args[0] ?? '').includes(String(args[1] ?? ''));
        case 'string-length':
          return String(args[0] ?? '').length;
        case 'count-selected':
          return words(args[0] ?? '').length;
        case 'string':
          return String(args[0] ?? '');
        case 'number':
          return asNumber(args[0] ?? Number.NaN);
        case 'true':
          return true;
        case 'false':
          return false;
        default:
          throw new Unsupported(node.name);
      }
    }
  }
}

/** The options a respondent was offered, given the question's filter and their answers. */
export function offeredChoices(
  expression: string,
  choices: Choice[],
  answer: (question: string) => unknown
): FilterResult {
  let tree: Node;
  try {
    tree = parse(expression);
  } catch {
    return { unknown: 'unsupported' };
  }
  // Columns some option of the list carries; one none has can't be tested.
  const columns = new Set(choices.flatMap((choice) => Object.keys(choice)));
  const offered = new Set<string>();
  try {
    for (const choice of choices) {
      if (truthy(evaluate(tree, choice, answer, columns))) offered.add(choice.name);
    }
  } catch (error) {
    return { unknown: error instanceof MissingColumn ? 'columns-missing' : 'unsupported' };
  }
  return { offered };
}
