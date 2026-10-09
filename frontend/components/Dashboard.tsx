import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Submission, FilterState, QueueSort, SubmissionFacets } from '../types';
import { api } from '../services/api';
import { useSurvey } from '../contexts/SurveyContext';
import { useActivity } from '../contexts/ActivityContext';
import { useReviewPreferences } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { menuFilterCount, stillMatches } from '../utils/filterUtils';
import { PullButton, PullStartError, usePull } from './activity/PullButton';
import SubmissionList, { TUCK_MS } from './SubmissionList';
import SubmissionDetail from './SubmissionDetail';
import QueueHeader from './review/QueueHeader';
import ReviewToast from './review/ReviewToast';
import { Decision } from './review/ReviewCard';
import ConfirmDialog from './ui/ConfirmDialog';
import { Spinner } from './Spinner';
import PageHeader from './ui/PageHeader';

const MAX_PAGE_SIZE = 100; // Matches backend validation limit for page_size
// After a decision the chosen button shows its colour this long before the
// submission leaves the list and the next one opens; its row folds away in
// the last part of it.
const SETTLE_MS = 600;
const FOCUS_KEY = 'submissionsFocus';

const readFocus = (): boolean => {
  try {
    return localStorage.getItem(FOCUS_KEY) === 'on';
  } catch {
    return false;
  }
};

/** A decision that can still be undone. */
interface LastDecision {
  before: Submission;
  /** Where it was in the list. */
  index: number;
  message: string;
}

const DONE: Record<string, string> = {
  Approved: 'Approved',
  'Not Approved': 'Marked not approved',
  'On Hold': 'Put on hold',
};

/** Every page of the list for these filters, and the order the server used. */
async function fetchQueue(filters: FilterState, surveyId: string) {
  const first = await api.getSubmissions(filters, surveyId, 1, MAX_PAGE_SIZE);
  const submissions = [...first.submissions];
  for (let page = 2; submissions.length < first.total; page += 1) {
    const next = await api.getSubmissions(filters, surveyId, page, MAX_PAGE_SIZE);
    if (next.submissions.length === 0) break;
    submissions.push(...next.submissions);
  }
  return { submissions, sort: first.sort };
}

interface DashboardProps {
  initialFilters?: FilterState;
}

/**
 * The Submissions page: a queue organised by review state, and the selected
 * submission with what was found, the decision and the answers. After a
 * decision the submission leaves a tab it no longer belongs in and, unless
 * the user turned it off, the next one opens.
 */
const Dashboard: React.FC<DashboardProps> = ({ initialFilters }) => {
  const { selectedSurvey } = useSurvey();
  const surveyId = selectedSurvey?.survey_id;
  const canEdit = selectedSurvey?.permission !== 'viewer';
  const { autoAdvance, shortcuts } = useReviewPreferences();
  const { requestedSubmission, reportPlace } = useNavigation();

  const [filters, setFilters] = useState<FilterState>(initialFilters ?? {});
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [facets, setFacets] = useState<SubmissionFacets | null>(null);
  const [sort, setSort] = useState<QueueSort | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);

  const [selected, setSelected] = useState<Submission | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<Decision | 'clear' | 'note' | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<LastDecision | null>(null);
  const [leavingId, setLeavingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [focus, setFocus] = useState(readFocus);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const { runs } = useActivity();
  // Progress and outcome are in the activity indicator in the top bar; the
  // list below is re-read as the run moves on.
  const pull = usePull();

  const select = useCallback((submission: Submission | null) => {
    setSelected(submission);
    setNote(submission?.reviewer_notes ?? '');
    setDecisionError(null);
  }, []);

  // A new survey, or a link from elsewhere, starts the queue afresh.
  useEffect(() => {
    cancelAdvance();
    setFilters(initialFilters ?? {});
    setSubmissions([]);
    setFacets(null);
    setLoading(true);
    select(null);
    setLastDecision(null);
  }, [surveyId, initialFilters, select]);

  useEffect(() => {
    if (!surveyId) return;
    getSurveyConfig(surveyId)
      .then(setSurveyConfig)
      .catch((err) => console.error('Failed to fetch survey config:', err));
  }, [surveyId]);

  // Several reads can be in flight (a filter change, a run moving on): only
  // the latest one may set the list, whichever answers last.
  const request = useRef(0);
  const load = useCallback(
    async (quiet: boolean) => {
      if (!surveyId) return;
      const id = ++request.current;
      if (!filters.review) {
        // No tab asked for: the server says which one to open on, and the
        // queue stays on it, even once a last decision empties it.
        try {
          const counts = await api.getSubmissionFacets(filters, surveyId);
          if (id === request.current)
            setFilters((current) => (current === filters ? { ...filters, review: counts.review } : current));
        } catch (err) {
          console.error(err);
          if (id === request.current) {
            setError('Couldn’t load the submissions.');
            setLoading(false);
          }
        }
        return;
      }
      setRefreshing(true);
      try {
        const [queue, counts] = await Promise.all([
          fetchQueue(filters, surveyId),
          api.getSubmissionFacets(filters, surveyId),
        ]);
        if (id !== request.current) return;
        setSubmissions(queue.submissions);
        setSort(queue.sort);
        setFacets(counts);
        setError(null);
        // Keep the open submission, fresh from the list; a filter change that
        // leaves it out closes it, a background refresh doesn't.
        setSelected((current) => {
          if (!current) return current;
          const fresh = queue.submissions.find((s) => s._id === current._id);
          return fresh ?? (quiet ? current : null);
        });
      } catch (err) {
        console.error(err);
        if (id === request.current) setError('Couldn’t load the submissions.');
      } finally {
        if (id === request.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [surveyId, filters]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // A submission the address asked for (a link, Back or Forward): opened once
  // the list is in, from the list or, when it isn't there, on its own; null
  // closes the one open.
  const [appliedAt, setAppliedAt] = useState<number>();
  const opening = !!requestedSubmission && appliedAt !== requestedSubmission.at;
  useEffect(() => {
    if (!requestedSubmission || !opening || loading || !surveyId) return;
    setAppliedAt(requestedSubmission.at);
    const { id } = requestedSubmission;
    const inList = submissions.find((s) => s._id === id);
    if (id === null || inList) select(inList ?? null);
    else
      api
        .getSubmission(id, surveyId)
        .then(select)
        .catch(() => undefined);
  }, [requestedSubmission, opening, loading, submissions, surveyId, select]);

  // The address shows the tab, filters and open submission; not while one it
  // asked for is still opening, which would take it out of the address.
  const openId = selected?._id ?? null;
  useEffect(() => {
    if (!opening) reportPlace({ filters, submissionId: openId });
  }, [filters, openId, opening, reportPlace]);

  const refreshCounts = useCallback(() => {
    if (!surveyId || !filters.review) return;
    api
      .getSubmissionFacets(filters, surveyId)
      .then(setFacets)
      .catch(() => undefined);
  }, [surveyId, filters]);

  // Re-read submissions as the survey's background work moves on, rather
  // than on a timer: when the pull lands, and as reviews and transcripts
  // finish. At most every few seconds.
  const { run, pulling: pullBusy } = pull;
  const surveyRunsKey = useMemo(
    () =>
      runs
        .filter((r) => r.survey_id === surveyId)
        .map(
          (r) =>
            `${r.run_id}:${r.status}:${r.ai_checks?.done}:${r.ai_checks?.failed}:${r.transcripts?.done}:${r.transcripts?.failed}:${r.kobo?.done}`
        )
        .join('|'),
    [runs, surveyId]
  );
  const lastRefetch = useRef(0);
  const pendingRefetch = useRef<number | null>(null);
  const previousStatus = useRef<string | undefined>(undefined);
  // The timer below fires later: it must load with the filters then in force.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!surveyId || !surveyRunsKey) return;
    const landed = !!previousStatus.current && previousStatus.current !== run?.status && !pullBusy;
    previousStatus.current = run?.status;
    if (pendingRefetch.current) window.clearTimeout(pendingRefetch.current);
    const wait = Math.max(0, 5000 - (Date.now() - lastRefetch.current));
    pendingRefetch.current = window.setTimeout(
      () => {
        lastRefetch.current = Date.now();
        pendingRefetch.current = null;
        loadRef.current(true);
      },
      landed ? 0 : wait
    );
    return () => {
      if (pendingRefetch.current) window.clearTimeout(pendingRefetch.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyRunsKey]);

  const index = selected ? submissions.findIndex((s) => s._id === selected._id) : -1;

  // The move to the next submission a decision has scheduled, while its
  // button shows the decision.
  const pendingAdvance = useRef<{ timers: number[]; run: () => void } | null>(null);
  const cancelAdvance = () => {
    pendingAdvance.current?.timers.forEach((timer) => window.clearTimeout(timer));
    pendingAdvance.current = null;
    setLeavingId(null);
  };
  /** Do the scheduled move now; says whether there was one. */
  const flushAdvance = (): boolean => {
    const pending = pendingAdvance.current;
    if (!pending) return false;
    cancelAdvance();
    pending.run();
    return true;
  };
  useEffect(() => cancelAdvance, []);

  // What the scheduled move reads when it runs, not when it was scheduled.
  const latest = useRef({ submissions, selected, filters, autoAdvance });
  latest.current = { submissions, selected, filters, autoAdvance };

  const move = useCallback(
    (step: 1 | -1) => {
      // Moving while a decision settles: with auto-advance, that move is the one.
      if (flushAdvance() && latest.current.autoAdvance) return;
      if (submissions.length === 0) return;
      if (index < 0) {
        select(submissions[step > 0 ? 0 : submissions.length - 1]);
        return;
      }
      const next = submissions[index + step];
      if (next) select(next);
    },
    [submissions, index, select]
  );

  const replaceInList = (after: Submission) =>
    setSubmissions((list) => list.map((s) => (s._id === after._id ? after : s)));

  const decide = async (status: Decision | null) => {
    if (!selected || !surveyId || saving) return;
    // A second decision on the same submission replaces the first's move.
    cancelAdvance();
    const before = selected;
    const position = index;
    setSaving(status ?? 'clear');
    setDecisionError(null);
    try {
      if (note.trim() !== (before.reviewer_notes ?? '').trim()) {
        await api.updateReviewerNotes(before._id, surveyId, note.trim() || null);
      }
      // The update answers without the list's transcript summary.
      const after = {
        ...(await api.updateValidationStatus(before._id, surveyId, status)),
        transcript_summary: before.transcript_summary,
      };
      const stays = stillMatches(after, filters);
      // Back in a tab it had left (e.g. on hold, then not reviewed again): the
      // list is read again so it sits in its place.
      if (stays && position < 0) loadRef.current(true);
      // The decision shows on this submission first, its button in colour.
      replaceInList(after);
      select(after);
      // Then it leaves a tab it no longer belongs in and, with auto-advance,
      // the next one opens, unless the reviewer has already moved elsewhere.
      const run = () => {
        const { submissions: list, selected: open, filters: now, autoAdvance: advance } = latest.current;
        const at = list.findIndex((s) => s._id === after._id);
        const leaves = !stillMatches(after, now);
        const rest = list.filter((s) => s._id !== after._id);
        if (leaves) setSubmissions(rest);
        if (!advance || at < 0 || open?._id !== after._id) return;
        const next = leaves ? (rest[at] ?? rest[at - 1]) : list[at + 1];
        if (next) select(next);
        else if (leaves) select(null);
      };
      pendingAdvance.current = {
        timers: [
          window.setTimeout(() => {
            if (!stillMatches(after, latest.current.filters)) setLeavingId(after._id);
          }, SETTLE_MS - TUCK_MS),
          window.setTimeout(flushAdvance, SETTLE_MS),
        ],
        run,
      };
      setNotice(null);
      setLastDecision({
        before,
        index: position,
        message: `${status ? DONE[status] : 'Marked not reviewed'} #${after._id}`,
      });
      refreshCounts();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : 'Couldn’t save the decision.');
    } finally {
      setSaving(null);
    }
  };

  const undo = async () => {
    if (!lastDecision || !surveyId || saving) return;
    cancelAdvance();
    const { before, index: position } = lastDecision;
    setLastDecision(null);
    setSaving('clear');
    try {
      const restored = {
        ...(await api.updateValidationStatus(before._id, surveyId, before.kobo_validation_status ?? null)),
        transcript_summary: before.transcript_summary,
      };
      setSubmissions((list) => {
        const without = list.filter((s) => s._id !== restored._id);
        if (!stillMatches(restored, filters)) return without;
        const at = Math.min(Math.max(position, 0), without.length);
        return [...without.slice(0, at), restored, ...without.slice(at)];
      });
      select(restored);
      refreshCounts();
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : 'Couldn’t undo the decision.');
    } finally {
      setSaving(null);
    }
  };

  const saveNote = async () => {
    if (!selected || !surveyId || saving) return;
    setSaving('note');
    setDecisionError(null);
    try {
      const after = {
        ...(await api.updateReviewerNotes(selected._id, surveyId, note.trim() || null)),
        transcript_summary: selected.transcript_summary,
      };
      replaceInList(after);
      setSelected(after);
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : 'Couldn’t save the note.');
    } finally {
      setSaving(null);
    }
  };

  const approveClean = async () => {
    if (!surveyId) return;
    setApproving(true);
    setApproveError(null);
    try {
      const result = await api.approveCleanSubmissions(filters, surveyId);
      setApproveOpen(false);
      setLastDecision(null);
      setNotice(
        result.failed > 0
          ? `Approved ${result.approved} in Kobo; Kobo refused ${result.failed}.`
          : `Approved ${result.approved} clean submission${result.approved === 1 ? '' : 's'} in Kobo.`
      );
      load(true);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Kobo did not accept the approvals.');
    } finally {
      setApproving(false);
    }
  };

  // Keys: J/K or arrows to move, A/N/H to decide, Z to undo, / to search.
  // The letters are a setting (WCAG 2.1.4), and never act while typing or in a dialog.
  const keys = useRef({ move, decide, undo, shortcuts, canEdit, selected, lastDecision });
  keys.current = { move, decide, undo, shortcuts, canEdit, selected, lastDecision };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const k = keys.current;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      let handled = true;
      if (key === 'ArrowDown' || (k.shortcuts && key === 'j')) k.move(1);
      else if (key === 'ArrowUp' || (k.shortcuts && key === 'k')) k.move(-1);
      else if (!k.shortcuts || event.shiftKey) handled = false;
      else if (key === '/') searchRef.current?.focus();
      else if (key === 'z' && k.lastDecision) k.undo();
      else if (k.selected && k.canEdit && (key === 'a' || key === 'n' || key === 'h'))
        k.decide(({ a: 'Approved', n: 'Not Approved', h: 'On Hold' } as const)[key]);
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFocus = () =>
    setFocus((on) => {
      try {
        localStorage.setItem(FOCUS_KEY, on ? 'off' : 'on');
      } catch {
        // The choice then lasts this visit.
      }
      return !on;
    });

  const changeFilters = useCallback((next: FilterState) => setFilters(next), []);
  const dismissToast = useCallback(() => {
    setLastDecision(null);
    setNotice(null);
  }, []);

  // With nothing open, the list stays, whatever the setting.
  const focused = focus && !!selected;
  const tab = filters.review;
  const clean = facets?.clean ?? { ready: 0, waiting: 0 };
  const narrowed = menuFilterCount(filters) > 0 || !!filters.search || !!filters.validationStatuses?.length;
  const offerApprove = canEdit && clean.ready > 0;

  const approveButton = (
    <button
      type="button"
      onClick={() => {
        setApproveError(null);
        setApproveOpen(true);
      }}
      className="text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:underline dark:text-indigo-300"
    >
      Approve {clean.ready} clean…
    </button>
  );

  const summary = !loading && !error && submissions.length > 0 && (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
      <span className="tabular" aria-live="polite">
        {submissions.length.toLocaleString()}{' '}
        {tab === 'needs_review'
          ? 'to review'
          : tab === 'on_hold'
            ? 'on hold'
            : tab === 'reviewed'
              ? 'reviewed'
              : submissions.length === 1
                ? 'submission'
                : 'submissions'}
      </span>
      {tab === 'all' && offerApprove && approveButton}
    </div>
  );

  const empty = loading ? (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  ) : error ? (
    <div className="flex flex-col items-center gap-2 p-6 text-center text-sm">
      <p className="text-red-700 dark:text-red-400">{error}</p>
      <button
        type="button"
        onClick={() => load(false)}
        className="text-indigo-700 hover:underline dark:text-indigo-300"
      >
        Try again
      </button>
    </div>
  ) : narrowed || filters.aiReview || filters.transcript ? (
    <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
      <p className="font-medium text-gray-900 dark:text-white">No submissions match</p>
      <button
        type="button"
        onClick={() => setFilters({ review: filters.review, sort: filters.sort })}
        className="text-indigo-700 hover:underline dark:text-indigo-300"
      >
        Clear filters and search
      </button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
      <p className="font-medium text-gray-900 dark:text-white">
        {tab === 'needs_review'
          ? 'Nothing needs review'
          : tab === 'on_hold'
            ? 'Nothing on hold'
            : tab === 'reviewed'
              ? 'No decisions yet'
              : 'No submissions yet'}
      </p>
      <p>
        {tab === 'needs_review'
          ? 'Every submission with findings has a decision.'
          : tab === 'all'
            ? 'Refresh from Kobo to pull them in.'
            : null}
      </p>
      {tab === 'needs_review' && offerApprove && (
        <p className="mt-2">
          {clean.ready} clean submission{clean.ready === 1 ? ' has' : 's have'} no decision yet. {approveButton}
        </p>
      )}
      {tab !== 'all' && (
        <button
          type="button"
          onClick={() => setFilters({ ...filters, review: 'all' })}
          className="mt-1 text-indigo-700 hover:underline dark:text-indigo-300"
        >
          See all submissions
        </button>
      )}
    </div>
  );

  const toast = lastDecision ? (
    <ReviewToast message={lastDecision.message} onUndo={undo} shortcuts={shortcuts} onDismiss={dismissToast} />
  ) : notice ? (
    <ReviewToast message={notice} shortcuts={shortcuts} onDismiss={dismissToast} />
  ) : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Submissions" actions={<PullButton pull={pull} />}>
        <PullStartError pull={pull} />
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Queue"
          className={`${selected ? 'hidden md:flex' : 'flex'} ${focused ? 'md:hidden' : ''} min-h-0 w-full flex-shrink-0 flex-col border-r border-gray-200 bg-white md:w-[22rem] lg:w-[24rem] dark:border-gray-800 dark:bg-gray-950`}
        >
          <QueueHeader
            filters={filters}
            facets={facets}
            surveyConfig={surveyConfig}
            sort={sort}
            loading={refreshing && !loading}
            onChange={changeFilters}
            searchRef={searchRef}
          />
          <div className="min-h-0 flex-1">
            <SubmissionList
              submissions={submissions}
              onSelect={(id) => select(submissions.find((s) => s._id === id) ?? null)}
              selectedSubmissionId={selected?._id ?? null}
              surveyConfig={surveyConfig}
              showStatus={tab !== 'needs_review'}
              summary={summary}
              empty={empty}
              leavingId={leavingId}
            />
          </div>
        </section>
        <div className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
          <SubmissionDetail
            submission={selected}
            surveyConfig={surveyConfig}
            position={{ index, total: submissions.length }}
            onPrevious={() => move(-1)}
            onNext={() => move(1)}
            onBack={() => select(null)}
            canEdit={canEdit}
            shortcuts={shortcuts}
            note={note}
            onNoteChange={setNote}
            saving={saving}
            error={decisionError}
            onDecide={decide}
            onSaveNote={saveNote}
            onFilterIssue={(check) => setFilters({ ...filters, issues: [check] })}
            focus={focused}
            onToggleFocus={toggleFocus}
          />
        </div>
      </div>

      {toast}

      <ConfirmDialog
        open={approveOpen}
        title={`Approve ${clean.ready} clean submission${clean.ready === 1 ? '' : 's'}?`}
        confirmLabel={`Approve ${clean.ready}`}
        tone="primary"
        busy={approving}
        onConfirm={approveClean}
        onCancel={() => setApproveOpen(false)}
      >
        <p>They have no findings, and every check on them has finished. Each is marked Approved in Kobo.</p>
        {clean.waiting > 0 && (
          <p>
            {clean.waiting} more {clean.waiting === 1 ? 'is' : 'are'} still waiting for an AI review or a transcript,
            and {clean.waiting === 1 ? 'is' : 'are'} left alone.
          </p>
        )}
        {(narrowed || filters.aiReview || filters.transcript) && (
          <p>Only submissions that match the current filters are included.</p>
        )}
        {approveError && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {approveError}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
};

export default Dashboard;
