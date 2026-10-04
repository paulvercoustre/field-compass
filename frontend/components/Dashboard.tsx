
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Submission, FilterState } from '../types';
import { api } from '../services/api';
import { useSurvey } from '../contexts/SurveyContext';
import { useActivity } from '../contexts/ActivityContext';
import { getSurveyConfig, SurveyConfig } from '../services/progressApi';
import { PullButton, PullStartError, usePull } from './activity/PullButton';
import SubmissionList from './SubmissionList';
import SubmissionDetail from './SubmissionDetail';
import SubmissionFilters from './SubmissionFilters';
import { Spinner } from './Spinner';
import PageHeader from './ui/PageHeader';

const MAX_PAGE_SIZE = 100; // Matches backend validation limit for page_size

interface DashboardProps {
  initialFilters?: FilterState;
}

const Dashboard: React.FC<DashboardProps> = ({ initialFilters }) => {
  const { selectedSurvey } = useSurvey();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]); // For filter options
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [filterState, setFilterState] = useState<FilterState>(initialFilters || {});
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState<boolean>(true);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const { runs } = useActivity();
  // Progress and outcome are in the activity indicator in the top bar; the
  // list below is re-read as the run moves on.
  const pull = usePull();

  const fetchSubmissionsAcrossPages = useCallback(
    async (filters?: FilterState): Promise<Submission[]> => {
      if (!selectedSurvey) return [];

      const combined: Submission[] = [];
      let page = 1;
      let total = 0;

      while (true) {
        const response = await api.getSubmissions(
          filters,
          selectedSurvey.survey_id,
          page,
          MAX_PAGE_SIZE
        );

        combined.push(...response.submissions);
        total = response.total;

        const effectivePageSize = response.page_size ?? MAX_PAGE_SIZE;
        const reachedTotal = combined.length >= total;
        const lastPage = response.submissions.length < effectivePageSize;

        if (reachedTotal || lastPage) {
          break;
        }

        page += 1;
      }

      return combined;
    },
    [selectedSurvey]
  );

  // Fetch all submissions for filter options
  const fetchAllSubmissions = useCallback(async () => {
    if (!selectedSurvey) return;

    try {
      setIsLoadingConfig(true);
      setError(null);
      const data = await fetchSubmissionsAcrossPages();
      setAllSubmissions(data);
    } catch (err) {
      setError('Failed to fetch submissions.');
      console.error(err);
    } finally {
      setIsLoadingConfig(false);
    }
  }, [selectedSurvey, fetchSubmissionsAcrossPages]);

  // Several reads can be in flight (a filter change, a run moving on): only
  // the latest one may set the list, whichever answers last.
  const filteredRequest = useRef(0);

  // Fetch filtered submissions
  const fetchFilteredSubmissions = useCallback(async () => {
    if (!selectedSurvey) return;
    const request = ++filteredRequest.current;

    try {
      setIsLoadingSubmissions(true);
      setError(null);
      const data = await fetchSubmissionsAcrossPages(filterState);
      if (request !== filteredRequest.current) return;
      setSubmissions(data);

      // Clear selected submission if it's no longer in the filtered results
      let clearedSelection = false;
      setSelectedSubmission(prev => {
        if (!prev) {
          return prev;
        }

        const stillExists = data.some(s => s._id === prev._id);
        if (!stillExists) {
          clearedSelection = true;
          return null;
        }
        return prev;
      });
    } catch (err) {
      if (request !== filteredRequest.current) return;
      setError('Failed to fetch submissions.');
      console.error(err);
    } finally {
      if (request === filteredRequest.current) setIsLoadingSubmissions(false);
    }
  }, [selectedSurvey, filterState, fetchSubmissionsAcrossPages]);

  // Fetch survey config
  const fetchSurveyConfig = useCallback(async () => {
    if (!selectedSurvey) return;

    try {
      setIsLoadingConfig(true);
      const config = await getSurveyConfig(selectedSurvey.survey_id);
      setSurveyConfig(config);
    } catch (err) {
      console.error('Failed to fetch survey config:', err);
      // Don't set error for config loading as it's not critical
    } finally {
      setIsLoadingConfig(false);
    }
  }, [selectedSurvey]);

  // Fetch all submissions and survey config when survey changes
  useEffect(() => {
    if (selectedSurvey) {
      fetchAllSubmissions();
      fetchSurveyConfig();
      // Reset to initial filters or empty when survey changes
      setFilterState(initialFilters || {});
    }
  }, [selectedSurvey, fetchAllSubmissions, fetchSurveyConfig]);

  // Update filter state when initialFilters prop changes (cross-navigation)
  useEffect(() => {
    if (initialFilters) {
      setFilterState(initialFilters);
    }
  }, [initialFilters]);

  // Fetch filtered submissions when filters change
  useEffect(() => {
    if (selectedSurvey) {
      fetchFilteredSubmissions();
    }
  }, [selectedSurvey, filterState, fetchFilteredSubmissions]);

  // This survey's latest run (a pull under way, or one just finished).
  const { run, pulling: pullBusy } = pull;

  // Re-read submissions as the survey's background work moves on, rather
  // than on a timer: when the pull lands, and as reviews and transcripts
  // finish. At most every few seconds.
  const surveyRunsKey = useMemo(
    () =>
      runs
        .filter((r) => r.survey_id === selectedSurvey?.survey_id)
        .map((r) => `${r.run_id}:${r.status}:${r.ai_checks?.done}:${r.ai_checks?.failed}:${r.transcripts?.done}:${r.transcripts?.failed}:${r.kobo?.done}`)
        .join('|'),
    [runs, selectedSurvey?.survey_id]
  );
  const lastRefetch = useRef(0);
  const pendingRefetch = useRef<number | null>(null);
  const previousStatus = useRef<string | undefined>(undefined);
  // The timer below fires later: it must call the fetches as they are then,
  // with the filters then in force, not as they were when it was set.
  const fetchFilteredRef = useRef(fetchFilteredSubmissions);
  fetchFilteredRef.current = fetchFilteredSubmissions;
  const fetchAllRef = useRef(fetchAllSubmissions);
  fetchAllRef.current = fetchAllSubmissions;
  useEffect(() => {
    if (!selectedSurvey || !surveyRunsKey) return;
    const landed = !!previousStatus.current && previousStatus.current !== run?.status && !pullBusy;
    previousStatus.current = run?.status;
    const refetch = () => {
      lastRefetch.current = Date.now();
      pendingRefetch.current = null;
      if (landed) fetchAllRef.current();
      fetchFilteredRef.current();
    };
    if (pendingRefetch.current) window.clearTimeout(pendingRefetch.current);
    const wait = Math.max(0, 5000 - (Date.now() - lastRefetch.current));
    pendingRefetch.current = window.setTimeout(refetch, landed ? 0 : wait);
    return () => {
      if (pendingRefetch.current) window.clearTimeout(pendingRefetch.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyRunsKey]);

  const handleSelectSubmission = useCallback(async (submissionId: number) => {
    const submission = submissions.find(s => s._id === submissionId);
    if (submission) {
      if (selectedSubmission?._id === submissionId) return; // Avoid refetching for the same submission
      setSelectedSubmission(submission);
    }
  }, [submissions, selectedSubmission]);

  const handleFiltersChange = useCallback((newFilters: FilterState) => {
    setFilterState(newFilters);
  }, []);

  const handleSubmissionUpdate = useCallback((updatedSubmission: Submission) => {
    setSelectedSubmission(updatedSubmission);
    setSubmissions(prev =>
      prev.map(s => s._id === updatedSubmission._id ? updatedSubmission : s)
    );
  }, []);

  // Keyboard navigation for submissions
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle arrow keys when a submission is selected and there are submissions
      if (!selectedSubmission || submissions.length === 0) {
        return;
      }

      // Don't handle if user is typing in an input field
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const currentIndex = submissions.findIndex(s => s._id === selectedSubmission._id);
      
      if (event.key === 'ArrowDown' && currentIndex < submissions.length - 1) {
        event.preventDefault();
        const nextSubmission = submissions[currentIndex + 1];
        handleSelectSubmission(nextSubmission._id);
      } else if (event.key === 'ArrowUp' && currentIndex > 0) {
        event.preventDefault();
        const prevSubmission = submissions[currentIndex - 1];
        handleSelectSubmission(prevSubmission._id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedSubmission, submissions, handleSelectSubmission]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Submissions"
        actions={<PullButton pull={pull} />}
      >
        <PullStartError pull={pull} />
      </PageHeader>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-shrink-0 w-full border-r border-gray-200 dark:border-gray-800 md:w-80 xl:w-96 bg-white dark:bg-gray-950 min-h-0">
          {/* Filters */}
          <SubmissionFilters
            submissions={allSubmissions}
            surveyConfig={surveyConfig}
            activeFilters={filterState}
            onFiltersChange={handleFiltersChange}
            isLoading={isLoadingSubmissions}
          />

          {isLoadingSubmissions ? (
            <div className="flex items-center justify-center flex-1 min-h-0">
              <Spinner />
            </div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden">
              <SubmissionList
                submissions={submissions}
                onSelect={handleSelectSubmission}
                selectedSubmissionId={selectedSubmission?._id ?? null}
              />
            </div>
          )}
        </div>
        <div className="flex-1 hidden md:block min-w-0">
          <SubmissionDetail
            submission={selectedSubmission}
            isLoading={false}
            onSubmissionUpdate={handleSubmissionUpdate}
          />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;