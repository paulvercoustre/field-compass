import React from 'react';
import { PerformanceData } from '../../types';

interface EnumeratorSummaryCardsProps {
  data: PerformanceData;
}

const EnumeratorSummaryCards: React.FC<EnumeratorSummaryCardsProps> = ({ data }) => {
  const { collection, quality } = data;
  
  // Calculate summary metrics
  const totalEnumerators = collection.length;
  const totalSubmissions = collection.reduce((sum, e) => sum + e.total, 0);
  const avgSubmissionsPerEnumerator = totalEnumerators > 0 
    ? (totalSubmissions / totalEnumerators).toFixed(1) 
    : '0';
  
  // No "top performer" card. The only ranking available here is the share a
  // reviewer has approved, which measures how far the review has got, not how
  // good the interviews were -- it put an enumerator with every submission
  // flagged on the podium.

  // Count enumerators needing attention (>30% flagged and not approved, or a
  // high issue rate)
  const enumeratorsNeedingAttention = collection.filter(e => {
    const needsReviewPercent = parseFloat(e.percentNeedsReview);
    const qualityStats = quality.find(q => q.id === e.id);
    const highIssueRate = qualityStats && qualityStats.avgIssuesPerSurvey > 2;
    return needsReviewPercent > 30 || highIssueRate;
  }).length;
  
  // Share of all submissions a reviewer has approved in Kobo
  const teamAvgValidated = totalSubmissions > 0
    ? ((collection.reduce((sum, e) => sum + e.validated, 0) / totalSubmissions) * 100).toFixed(1)
    : '0';
  
  const totalIssues = quality.reduce((sum, q) => sum + (q.avgIssuesPerSurvey * collection.find(c => c.id === q.id)?.total || 0), 0);
  const teamAvgIssuesPerSubmission = totalSubmissions > 0
    ? (totalIssues / totalSubmissions).toFixed(2)
    : '0';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
      {/* Total Enumerators */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">Enumerators</div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
          {totalEnumerators}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">active</div>
      </div>
      
      {/* Total Submissions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">Submissions</div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
          {totalSubmissions}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {avgSubmissionsPerEnumerator} per enumerator on average
        </div>
      </div>
      
      {/* Review progress: neutral, because a low number means "not reviewed
          yet" as often as "rejected". */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">Approved by reviewer</div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
          {teamAvgValidated}%
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">of submissions, approved in Kobo</div>
      </div>
      
      {/* Avg Issues per Submission */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">Avg Issues</div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
          {teamAvgIssuesPerSubmission}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">per submission</div>
      </div>
      
      {/* Needs Attention */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400 font-medium">Need Attention</div>
        <div className={`text-2xl font-bold mt-1 ${
          enumeratorsNeedingAttention > 0 
            ? 'text-amber-600 dark:text-amber-400' 
            : 'text-emerald-600 dark:text-emerald-400'
        }`}>
          {enumeratorsNeedingAttention}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">over 30% flagged and not approved, or over 2 issues per submission</div>
      </div>
    </div>
  );
};

export default EnumeratorSummaryCards;
