import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { SurveyConfig } from '../../services/progressApi';
import { AnswerChange, Edit, editsOf } from '../../utils/editHistory';
import { formatValueForDisplay, questionText } from '../../utils/koboLabelUtils';

const shown = (value: unknown, question: string, config: SurveyConfig | null): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'object') return '…';
  return formatValueForDisplay(value, question, config);
};

const ChangeLine: React.FC<{
  change: AnswerChange;
  config: SurveyConfig | null;
  data: Record<string, unknown>;
}> = ({ change, config, data }) => {
  const label = questionText(change.question, config, data);
  const item = change.item ? ` (item ${change.item})` : '';
  const before = shown(change.before, change.question, config);
  const after = shown(change.after, change.question, config);
  return (
    <li className="leading-snug">
      <span className="text-gray-600 dark:text-gray-400">
        {label}
        {item}
        {/[?:]$/.test(label + item) ? '' : ':'}
      </span>{' '}
      {change.kind === 'answered' && typeof change.after === 'object' ? (
        <span className="text-gray-900 dark:text-gray-100">a new item</span>
      ) : change.kind === 'cleared' ? (
        <span className="text-gray-900 dark:text-gray-100">
          cleared{change.before !== undefined && <span className="text-gray-500"> (was {before})</span>}
        </span>
      ) : change.before !== undefined ? (
        <>
          <span className="text-gray-500 line-through decoration-gray-400 dark:text-gray-400">{before}</span>
          <span className="mx-1 text-gray-400" aria-label="changed to">
            →
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{after}</span>
        </>
      ) : (
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {change.kind === 'answered' ? after : `now ${after}`}
        </span>
      )}
    </li>
  );
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * What the edits made in Kobo changed, newest first: each answer's old value
 * against its new one. Edits stored before old values were kept show only
 * the new value.
 */
const EditHistory: React.FC<{
  submissionId: number;
  config: SurveyConfig | null;
  data: Record<string, unknown>;
}> = ({ submissionId, config, data }) => {
  const [edits, setEdits] = useState<Edit[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEdits(null);
    setError(false);
    api
      .getSubmissionHistory(submissionId)
      .then((records) => !cancelled && setEdits(editsOf(records)))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[13px] dark:border-amber-500/20 dark:bg-amber-500/[0.06]">
      {error ? (
        <p className="text-red-700 dark:text-red-400">Couldn’t load the changes. Try again in a moment.</p>
      ) : edits === null ? (
        <p className="text-gray-500 dark:text-gray-400">Loading the changes…</p>
      ) : edits.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">
          Kobo says this submission was edited, but no changes were recorded here.
        </p>
      ) : (
        <ol className="space-y-2">
          {edits.map((edit) => (
            <li key={edit.id}>
              <p className="font-medium text-gray-900 dark:text-white">Edited {when(edit.at)}</p>
              {edit.changes.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">No answers changed, only Kobo’s own fields.</p>
              ) : (
                <ul className="mt-0.5 space-y-0.5">
                  {edit.changes.map((change, index) => (
                    <ChangeLine key={index} change={change} config={config} data={data} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default EditHistory;
