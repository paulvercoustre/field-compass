/**
 * A submission's edits in Kobo, as changes to its answers: what each answer
 * was and became. Kobo's own fields (instance IDs, version, metadata) change
 * with every edit and are left out.
 */

/** One stored edit: when, and Kobo's JSON-patch of the submission's data. */
export interface EditRecord {
  history_id: number;
  timestamp: string;
  data_delta: Array<{ op: string; path: string; value?: unknown; old?: unknown }>;
}

export interface AnswerChange {
  /** The question's name, without its group path. */
  question: string;
  /** In a repeat: which item, counting from 1. */
  item?: number;
  kind: 'changed' | 'answered' | 'cleared';
  /** What it was; unknown for edits stored before it was kept. */
  before?: unknown;
  after?: unknown;
}

export interface Edit {
  id: number;
  at: string;
  changes: AnswerChange[];
}

// Fields Kobo or Field Compass fill in, which change with every edit.
const NOT_ANSWERS = /^(_|meta\/|formhub\/|__version__$)/;
const RECORDED = new Set(['start', 'end', 'today', 'deviceid', 'active_interview_time', 'total_duration']);

const segments = (pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));

const KINDS: Record<string, AnswerChange['kind']> = { replace: 'changed', add: 'answered', remove: 'cleared' };

export function editsOf(records: EditRecord[]): Edit[] {
  return records.map((record) => ({
    id: record.history_id,
    at: record.timestamp,
    changes: record.data_delta.flatMap((op): AnswerChange[] => {
      const kind = KINDS[op.op];
      const parts = segments(op.path);
      if (!kind || !parts[0] || NOT_ANSWERS.test(parts[0])) return [];
      // "/hh_roster/0/hh_roster~1name": the name answer of the roster's first item.
      const index = parts.findIndex((part) => /^\d+$/.test(part));
      const question = parts[parts.length - 1].split('/').pop()!;
      if (RECORDED.has(question)) return [];
      return [
        {
          question: /^\d+$/.test(question) ? parts[0].split('/').pop()! : question,
          item: index >= 0 ? Number(parts[index]) + 1 : undefined,
          kind,
          // The API sends null when an edit was stored before old values were kept.
          before: op.old ?? undefined,
          after: op.value,
        },
      ];
    }),
  }));
}
