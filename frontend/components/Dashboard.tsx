
import React, { useState, useEffect, useCallback } from 'react';
import { Submission, FilterState } from '../types';
import { api } from '../services/api';
import { useSurvey } from '../contexts/SurveyContext';
import { triggerETL, ETLStats, getSurveyConfig, SurveyConfig } from '../services/progressApi';
import SubmissionList from './SubmissionList';
import SubmissionDetail from './SubmissionDetail';
import SubmissionFilters from './SubmissionFilters';
import { Spinner } from './Spinner';
import PageHeader from './ui/PageHeader';
import Button from './ui/Button';
import Banner from './ui/Banner';
import { RefreshIcon } from './ui/icons';

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
  const [isRunningETL, setIsRunningETL] = useState<boolean>(false);
  const [etlStats, setEtlStats] = useState<ETLStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  // Fetch filtered submissions
  const fetchFilteredSubmissions = useCallback(async () => {
    if (!selectedSurvey) return;

    try {
      setIsLoadingSubmissions(true);
      setError(null);
      const data = await fetchSubmissionsAcrossPages(filterState);
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
      setError('Failed to fetch submissions.');
      console.error(err);
    } finally {
      setIsLoadingSubmissions(false);
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

  // Auto-refresh while any LLM qualitative checks are pending/running.
  useEffect(() => {
    if (!selectedSurvey) return;
    const hasActiveLLMJobs = submissions.some(
      (s) => s.llm_check_status === 'pending' || s.llm_check_status === 'running'
    );
    if (!hasActiveLLMJobs) return;

    const intervalId = window.setInterval(() => {
      fetchFilteredSubmissions();
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [selectedSurvey, submissions, fetchFilteredSubmissions]);

  const handleRefresh = async () => {
    if (!selectedSurvey) {
      setError('Please select a survey first');
      return;
    }

    setIsRunningETL(true);
    setError(null);
    setSuccess(null);
    setEtlStats(null);

    try {
      // Trigger ETL pipeline
      const stats = await triggerETL(selectedSurvey.survey_id);
      setEtlStats(stats);
      
      // Refresh submissions after ETL completes
      await fetchAllSubmissions();
      await fetchFilteredSubmissions();
      
      const checkedCount = (stats.validated || 0);
      const skippedCount = (stats.skipped || 0);
      const aiParts = [
        `${stats.llm_queued || 0} started`,
        ...(stats.llm_not_run_allowance ? [`${stats.llm_not_run_allowance} not run (free AI allowance used)`] : []),
        ...(stats.llm_paused ? [`${stats.llm_paused} not run (your AI provider is not working)`] : []),
      ];
      setSuccess(
        `ETL completed: ${stats.fetched} fetched, ${stats.created} created, ${stats.updated} updated, ${checkedCount} checked${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}, ${stats.hfc_flagged} flagged. AI review: ${aiParts.join(', ')}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run ETL pipeline');
      console.error(err);
    } finally {
      setIsRunningETL(false);
    }
  };

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
        actions={
          <>
            {etlStats && (
              <span className="tabular text-xs text-gray-500 dark:text-gray-400">
                Last run took {etlStats.duration_seconds.toFixed(1)}s
              </span>
            )}
            <Button
              variant="primary"
              onClick={handleRefresh}
              disabled={!selectedSurvey}
              loading={isRunningETL}
              icon={<RefreshIcon />}
            >
              {isRunningETL ? 'Running ETL…' : 'Refresh from Kobo'}
            </Button>
          </>
        }
      >
        {error && <Banner tone="error" className="mt-3">{error}</Banner>}
        {success && <Banner tone="success" className="mt-3">{success}</Banner>}
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
          ) : error && !isRunningETL ? (
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