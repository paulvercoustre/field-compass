
import React, { useState, useEffect, useCallback } from 'react';
import { Submission, SubmissionHistory } from '../types';
import { api } from '../services/api';
import { useSurvey } from '../contexts/SurveyContext';
import SubmissionList from './SubmissionList';
import SubmissionDetail from './SubmissionDetail';
import { Spinner } from './Spinner';

const Dashboard: React.FC = () => {
  const { selectedSurvey } = useSurvey();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [history, setHistory] = useState<SubmissionHistory[]>([]);
  const [isLoadingSubmissions, setIsLoadingSubmissions] = useState<boolean>(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubmissions = async () => {
      try {
        setIsLoadingSubmissions(true);
        const data = await api.getSubmissions(
          undefined, // qaStatus
          selectedSurvey?.survey_id // surveyId
        );
        setSubmissions(data);
        setError(null);
      } catch (err) {
        setError('Failed to fetch submissions.');
        console.error(err);
      } finally {
        setIsLoadingSubmissions(false);
      }
    };
    fetchSubmissions();
  }, [selectedSurvey]);

  const handleSelectSubmission = useCallback(async (submissionId: number) => {
    const submission = submissions.find(s => s._id === submissionId);
    if (submission) {
      if (selectedSubmission?._id === submissionId) return; // Avoid refetching for the same submission
      setSelectedSubmission(submission);
      try {
        setIsLoadingHistory(true);
        setHistory([]);
        const historyData = await api.getSubmissionHistory(submissionId);
        setHistory(historyData);
      } catch (err) {
        setError('Failed to fetch submission history.');
        console.error(err);
      } finally {
        setIsLoadingHistory(false);
      }
    }
  }, [submissions, selectedSubmission]);

  return (
    <div className="flex h-full">
      <div className="flex-shrink-0 w-full border-r border-gray-700 md:w-1/3 lg:w-1/4 xl:w-1/5 bg-gray-850">
        {isLoadingSubmissions ? (
          <div className="flex items-center justify-center h-full">
            <Spinner />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-red-400">{error}</div>
        ) : (
          <SubmissionList
            submissions={submissions}
            onSelect={handleSelectSubmission}
            selectedSubmissionId={selectedSubmission?._id ?? null}
          />
        )}
      </div>
      <div className="flex-1 hidden md:block">
        <SubmissionDetail
          submission={selectedSubmission}
          history={history}
          isLoading={isLoadingHistory}
        />
      </div>
    </div>
  );
};

export default Dashboard;