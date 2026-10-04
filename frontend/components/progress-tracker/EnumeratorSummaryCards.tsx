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
  
  // Count enumerators needing attention (>30% needs review or high issue rate)
  const enumeratorsNeedingAttention = collection.filter(e => {
    const needsReviewPercent = parseFloat(e.percentNeedsReview);
    const qualityStats = quality.find(q => q.id === e.id);
    const highIssueRate = qualityStats && qualityStats.avgIssuesPerSurvey > 2;
    return needsReviewPercent > 30 || highIssueRate;
  }).length;
  
  // Share of submissions a reviewer has approved in Kobo: how far review
  // has got, not how good the interviews were.
  const teamApproved = totalSubmissions > 0
    ? ((collection.reduce((sum, e) => sum + e.validated, 0) / totalSubmissions) * 100).toFixed(1)
    : '0';
  
  const totalIssues = quality.reduce((sum, q) => sum + (q.avgIssuesPerSurvey * collection.find(c => c.id === q.id)?.total || 0), 0);
  const teamAvgIssuesPerSubmission = totalSubmissions > 0
    ? (totalIssues / totalSubmissions).toFixed(2)
    : '0';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {/* Total Enumerators */}
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card border border-gray-200 dark:border-gray-800">
        <div className="text-sm text-gray-500 dark:text-gray-400">Enumerators</div>
        <div className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white mt-2">
          {totalEnumerators}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">active</div>
      </div>
      
      {/* Total Submissions */}
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card border border-gray-200 dark:border-gray-800">
        <div className="text-sm text-gray-500 dark:text-gray-400">Submissions</div>
        <div className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white mt-2">
          {totalSubmissions}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {avgSubmissionsPerEnumerator} per enumerator
        </div>
      </div>
      
      {/* Review progress */}
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card border border-gray-200 dark:border-gray-800">
        <div className="text-sm text-gray-500 dark:text-gray-400">Approved by reviewer</div>
        <div className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white mt-2">
          {teamApproved}%
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">of submissions</div>
      </div>
      
      {/* Avg Issues per Submission */}
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card border border-gray-200 dark:border-gray-800">
        <div className="text-sm text-gray-500 dark:text-gray-400">Issues</div>
        <div className="tabular text-2xl font-semibold tracking-tight text-gray-900 dark:text-white mt-2">
          {teamAvgIssuesPerSubmission}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">per submission</div>
      </div>
      
      {/* Needs Attention */}
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 shadow-card border border-gray-200 dark:border-gray-800">
        <div className="text-sm text-gray-500 dark:text-gray-400">Often flagged</div>
        <div className={`tabular text-2xl font-semibold tracking-tight mt-1 ${
          enumeratorsNeedingAttention > 0 
            ? 'text-amber-600 dark:text-amber-400' 
            : 'text-emerald-600 dark:text-emerald-400'
        }`}>
          {enumeratorsNeedingAttention}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">enumerators: over 30% flagged, or 2+ issues each</div>
      </div>
    </div>
  );
};

export default EnumeratorSummaryCards;
