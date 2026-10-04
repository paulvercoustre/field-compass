import React, { useState, useMemo } from 'react';
import { PerformanceData, EnumeratorCollectionStats, EnumeratorQualityStats } from '../../types';
import InfoModal from './InfoModal';
import { SubTabButton } from '../ui/SubTabButton';

type PerformanceSubTab = 'collected' | 'quality';
type SortDirection = 'asc' | 'desc';
type CollectionSortKey = 'id' | 'needsReview' | 'validated' | 'total' | 'percentValidated' | 'percentNeedsReview';
type QualitySortKey = 'id' | 'avgActiveTime' | 'avgTotalTime' | 'avgDkRate' | 'avgIssuesPerSurvey';

const DEFINITIONS: Record<string, { title: string; text: string }> = {
  needsReview: { title: "Flagged, not yet approved", text: "Submissions where the checks found at least one issue, and that no reviewer has approved or rejected in Kobo yet." },
  validated: { title: "Approved by reviewer", text: "Submissions a reviewer marked Approved in Kobo. This says how far review has got, not how good the interviews were: an enumerator whose work has not been reviewed yet has few." },
  totalSurveys: { title: "Total", text: "All of this enumerator's submissions pulled from Kobo, except deleted ones." },
  percentValidated: { title: "% Approved by reviewer", text: "The share of this enumerator's submissions that a reviewer approved in Kobo. Low while review is behind; not a measure of quality." },
  percentNeedsReview: { title: "% Flagged, not yet approved", text: "The share of this enumerator's submissions with issues that no reviewer has decided on yet." },
  avgActiveTime: { title: "Avg. Active Survey Time (min)", text: "The average time the enumerator spent actively answering questions (e.g., excluding pauses). Requires audit logs." },
  avgTotalTime: { title: "Avg. Total Survey Time (min)", text: "The average total time from the first event to the last event in the audit log." },
  avgDkRate: { title: "Avg. DK Rate (%)", text: "The average percentage of 'Don\\'t Know' or equivalent answers across all questions for this enumerator." },
  avgIssuesPerSurvey: { title: "Issues per submission", text: "The average number of issues the checks found per submission from this enumerator, whether or not a reviewer has seen them. A higher number may mean they need follow-up." },
};

const InfoIcon: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <span onClick={onClick} className="cursor-pointer text-gray-600 dark:text-gray-400 font-bold ml-1 hover:text-gray-900 dark:hover:text-white">&#9432;</span>
);

const SortIcon: React.FC<{ direction: SortDirection | null }> = ({ direction }) => {
  if (!direction) {
    return <span className="ml-1 text-gray-400">↕</span>;
  }
  return <span className="ml-1 text-indigo-500">{direction === 'asc' ? '↑' : '↓'}</span>;
};

interface PerformanceDataViewProps {
  data: PerformanceData;
  onEnumeratorClick?: (enumeratorId: string) => void;
}

const PerformanceDataView: React.FC<PerformanceDataViewProps> = ({ data, onEnumeratorClick }) => {
  const [activeSubTab, setActiveSubTab] = useState<PerformanceSubTab>('collected');
  const [filter, setFilter] = useState('');
  const [modalContent, setModalContent] = useState<{ title: string; text: string } | null>(null);
  
  // Sorting state
  const [collectionSort, setCollectionSort] = useState<{ key: CollectionSortKey; dir: SortDirection }>({ key: 'total', dir: 'desc' });
  const [qualitySort, setQualitySort] = useState<{ key: QualitySortKey; dir: SortDirection }>({ key: 'avgIssuesPerSurvey', dir: 'desc' });

  const handleShowModal = (key: string) => {
    if (DEFINITIONS[key]) {
      setModalContent(DEFINITIONS[key]);
    }
  };

  // Calculate team averages
  const teamAverages = useMemo(() => {
    const totalSubmissions = data.collection.reduce((sum, e) => sum + e.total, 0);
    const totalValidated = data.collection.reduce((sum, e) => sum + e.validated, 0);
    const totalNeedsReview = data.collection.reduce((sum, e) => sum + e.needsReview, 0);
    
    const avgTotal = data.collection.length > 0 ? totalSubmissions / data.collection.length : 0;
    const avgValidatedPercent = totalSubmissions > 0 ? (totalValidated / totalSubmissions) * 100 : 0;
    const avgNeedsReviewPercent = totalSubmissions > 0 ? (totalNeedsReview / totalSubmissions) * 100 : 0;
    
    const avgActiveTime = data.quality.length > 0 
      ? data.quality.reduce((sum, q) => sum + q.avgActiveTime, 0) / data.quality.length 
      : 0;
    const avgTotalTime = data.quality.length > 0 
      ? data.quality.reduce((sum, q) => sum + q.avgTotalTime, 0) / data.quality.length 
      : 0;
    const avgIssues = data.quality.length > 0 
      ? data.quality.reduce((sum, q) => sum + q.avgIssuesPerSurvey, 0) / data.quality.length 
      : 0;
    const avgDkRate = data.quality.length > 0 
      ? data.quality.reduce((sum, q) => sum + parseFloat(q.avgDkRate), 0) / data.quality.length 
      : 0;

    return {
      total: avgTotal,
      validatedPercent: avgValidatedPercent,
      needsReviewPercent: avgNeedsReviewPercent,
      activeTime: avgActiveTime,
      totalTime: avgTotalTime,
      issues: avgIssues,
      dkRate: avgDkRate,
    };
  }, [data]);

  const filteredCollectionData = useMemo(() => {
    let filtered = data.collection;
    if (filter) {
      filtered = filtered.filter(row => row.id.toLowerCase().includes(filter.toLowerCase()));
    }
    
    // Sort
    return [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      
      switch (collectionSort.key) {
        case 'id':
          aVal = a.id.toLowerCase();
          bVal = b.id.toLowerCase();
          break;
        case 'percentValidated':
          aVal = parseFloat(a.percentValidated);
          bVal = parseFloat(b.percentValidated);
          break;
        case 'percentNeedsReview':
          aVal = parseFloat(a.percentNeedsReview);
          bVal = parseFloat(b.percentNeedsReview);
          break;
        default:
          aVal = a[collectionSort.key];
          bVal = b[collectionSort.key];
      }
      
      if (aVal < bVal) return collectionSort.dir === 'asc' ? -1 : 1;
      if (aVal > bVal) return collectionSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data.collection, filter, collectionSort]);

  const filteredQualityData = useMemo(() => {
    let filtered = data.quality;
    if (filter) {
      filtered = filtered.filter(row => row.id.toLowerCase().includes(filter.toLowerCase()));
    }
    
    // Sort
    return [...filtered].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      
      switch (qualitySort.key) {
        case 'id':
          aVal = a.id.toLowerCase();
          bVal = b.id.toLowerCase();
          break;
        case 'avgDkRate':
          aVal = parseFloat(a.avgDkRate);
          bVal = parseFloat(b.avgDkRate);
          break;
        default:
          aVal = a[qualitySort.key];
          bVal = b[qualitySort.key];
      }
      
      if (aVal < bVal) return qualitySort.dir === 'asc' ? -1 : 1;
      if (aVal > bVal) return qualitySort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data.quality, filter, qualitySort]);

  const handleCollectionSort = (key: CollectionSortKey) => {
    setCollectionSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleQualitySort = (key: QualitySortKey) => {
    setQualitySort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Color coding helpers. Approval share is not coloured: it measures review
  // progress, and a low one says nothing against the enumerator.
  const getNeedsReviewColor = (percentStr: string) => {
    const percent = parseFloat(percentStr);
    if (percent <= 10) return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
    if (percent <= 30) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  };

  const getIssuesColor = (issues: number) => {
    if (issues < 1) return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
    if (issues < 2) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  };

  // `higherIsBetter: null`: above or below the team, with no verdict (time
  // spent, where both very short and very long interviews are worth a look).
  const getComparisonBadge = (value: number, avg: number, higherIsBetter: boolean | null = true) => {
    const diff = ((value - avg) / avg) * 100;
    if (!isFinite(diff) || Math.abs(diff) < 5) return null; // Within 5% of average

    const arrow = diff > 0 ? '↑' : '↓';
    const colorClass =
      higherIsBetter === null
        ? 'text-gray-500 dark:text-gray-400'
        : (higherIsBetter ? diff > 0 : diff < 0)
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-red-600 dark:text-red-400';
    
    return (
      <span className={`ml-1 text-xs ${colorClass}`} title={`${diff > 0 ? '+' : ''}${diff.toFixed(0)}% vs avg`}>
        {arrow}
      </span>
    );
  };

  const SortableHeader: React.FC<{
    label: string;
    sortKey: CollectionSortKey | QualitySortKey;
    currentSort: { key: string; dir: SortDirection };
    onSort: (key: any) => void;
    infoKey?: string;
  }> = ({ label, sortKey, currentSort, onSort, infoKey }) => (
    <th 
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center">
        {label}
        <SortIcon direction={currentSort.key === sortKey ? currentSort.dir : null} />
        {infoKey && <InfoIcon onClick={(e: any) => { e.stopPropagation(); handleShowModal(infoKey); }} />}
      </div>
    </th>
  );

  const renderContent = () => {
    if (activeSubTab === 'collected') {
      return (
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <SortableHeader label="Enumerator ID" sortKey="id" currentSort={collectionSort} onSort={handleCollectionSort} />
              <SortableHeader label="Flagged, not yet approved" sortKey="needsReview" currentSort={collectionSort} onSort={handleCollectionSort} infoKey="needsReview" />
              <SortableHeader label="Approved by reviewer" sortKey="validated" currentSort={collectionSort} onSort={handleCollectionSort} infoKey="validated" />
              <SortableHeader label="Total" sortKey="total" currentSort={collectionSort} onSort={handleCollectionSort} infoKey="totalSurveys" />
              <SortableHeader label="% Approved" sortKey="percentValidated" currentSort={collectionSort} onSort={handleCollectionSort} infoKey="percentValidated" />
              <SortableHeader label="% Flagged, not yet approved" sortKey="percentNeedsReview" currentSort={collectionSort} onSort={handleCollectionSort} infoKey="percentNeedsReview" />
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-950 divide-y divide-gray-100 dark:divide-gray-800">
            {filteredCollectionData.map(row => (
              <tr 
                key={row.id} 
                className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${onEnumeratorClick ? 'cursor-pointer' : ''}`}
                onClick={() => onEnumeratorClick?.(row.id)}
              >
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular font-medium text-gray-900 dark:text-white">
                  {row.id}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.needsReview}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.validated}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.total}
                  {getComparisonBadge(row.total, teamAverages.total, null)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.percentValidated}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular">
                  <span className={`px-2 py-1 rounded-md text-xs font-medium ${getNeedsReviewColor(row.percentNeedsReview)}`}>
                    {row.percentNeedsReview}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (activeSubTab === 'quality') {
      return (
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <SortableHeader label="Enumerator ID" sortKey="id" currentSort={qualitySort} onSort={handleQualitySort} />
              <SortableHeader label="Avg Active Time (min)" sortKey="avgActiveTime" currentSort={qualitySort} onSort={handleQualitySort} infoKey="avgActiveTime" />
              <SortableHeader label="Avg Total Time (min)" sortKey="avgTotalTime" currentSort={qualitySort} onSort={handleQualitySort} infoKey="avgTotalTime" />
              <SortableHeader label="Avg DK Rate (%)" sortKey="avgDkRate" currentSort={qualitySort} onSort={handleQualitySort} infoKey="avgDkRate" />
              <SortableHeader label="Issues per submission" sortKey="avgIssuesPerSurvey" currentSort={qualitySort} onSort={handleQualitySort} infoKey="avgIssuesPerSurvey" />
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-950 divide-y divide-gray-100 dark:divide-gray-800">
            {filteredQualityData.map(row => (
              <tr 
                key={row.id}
                className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${onEnumeratorClick ? 'cursor-pointer' : ''}`}
                onClick={() => onEnumeratorClick?.(row.id)}
              >
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular font-medium text-gray-900 dark:text-white">
                  {row.id}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.avgActiveTime}
                  {getComparisonBadge(row.avgActiveTime, teamAverages.activeTime, null)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.avgTotalTime}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular text-gray-700 dark:text-gray-300">
                  {row.avgDkRate}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-sm tabular">
                  <span className={`px-2 py-1 rounded-md text-xs font-medium ${getIssuesColor(row.avgIssuesPerSurvey)}`}>
                    {row.avgIssuesPerSurvey.toFixed(2)}
                  </span>
                  {getComparisonBadge(row.avgIssuesPerSurvey, teamAverages.issues, false)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return null;
  };

  return (
    <div>
      {modalContent && <InfoModal title={modalContent.title} text={modalContent.text} onClose={() => setModalContent(null)} />}
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">Detailed Data</h2>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by Enumerator ID..."
          className="w-full sm:w-64 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs placeholder-gray-500 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
        />
      </div>
      
      <div className="mb-4 inline-flex flex-wrap gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900">
        <SubTabButton<PerformanceSubTab> tabId="collected" activeTab={activeSubTab} onClick={setActiveSubTab}>
          Survey Collected
        </SubTabButton>
        <SubTabButton<PerformanceSubTab> tabId="quality" activeTab={activeSubTab} onClick={setActiveSubTab}>
          Survey Quality
        </SubTabButton>
      </div>
      
      {/* Team Averages Bar */}
      <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
        <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">Team Averages</div>
        <div className="flex flex-wrap gap-4 text-xs text-indigo-600 dark:text-indigo-400">
          {activeSubTab === 'collected' ? (
            <>
              <span>Submissions: <strong>{teamAverages.total.toFixed(1)}</strong>/enum</span>
              <span>Approved by reviewer: <strong>{teamAverages.validatedPercent.toFixed(1)}%</strong></span>
              <span>Flagged, not yet approved: <strong>{teamAverages.needsReviewPercent.toFixed(1)}%</strong></span>
            </>
          ) : (
            <>
              <span>Active Time: <strong>{teamAverages.activeTime.toFixed(0)}</strong> min</span>
              <span>Total Time: <strong>{teamAverages.totalTime.toFixed(0)}</strong> min</span>
              <span>Issues: <strong>{teamAverages.issues.toFixed(2)}</strong>/sub</span>
            </>
          )}
        </div>
      </div>
      
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-card dark:border-gray-800 dark:bg-gray-950">
        {renderContent()}
      </div>
      
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        ↑↓ more than 5% above or below the team average. Green or red only where more or less is clearly better.
      </p>
    </div>
  );
};

export default PerformanceDataView;
