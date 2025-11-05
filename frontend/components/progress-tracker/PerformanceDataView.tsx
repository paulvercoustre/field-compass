
import React, { useState, useMemo } from 'react';
import { PerformanceData } from '../../types';
import InfoModal from './InfoModal';
import { SubTabButton } from '../ui/SubTabButton';

type PerformanceSubTab = 'collected' | 'quality';

const DEFINITIONS: Record<string, { title: string; text: string }> = {
  needsReview: { title: "Needs Review", text: "The number of surveys where at least one potential issue was flagged." },
  validated: { title: "Validated", text: "The number of surveys with no issues found." },
  totalSurveys: { title: "Total Surveys", text: "The total number of surveys submitted by the enumerator that have been checked (excluding deleted surveys)." },
  percentValidated: { title: "% Validated", text: "The percentage of checked surveys that were validated." },
  percentNeedsReview: { title: "% Needs Review", text: "The percentage of checked surveys that have issues needing review." },
  avgActiveTime: { title: "Avg. Active Survey Time (min)", text: "The average time the enumerator spent actively answering questions (e.g., excluding pauses). Requires audit logs." },
  avgTotalTime: { title: "Avg. Total Survey Time (min)", text: "The average total time from the first event to the last event in the audit log." },
  avgDkRate: { title: "Avg. DK Rate (%)", text: "The average percentage of 'Don\\'t Know' or equivalent answers across all questions for this enumerator." },
  avgIssuesPerSurvey: { title: "Avg. Issues per Survey", text: "The average number of cleaning log issues flagged per survey for this enumerator. A higher number may indicate a need for follow-up." },
};

const InfoIcon: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <span onClick={onClick} className="cursor-pointer text-gray-400 font-bold ml-1 hover:text-white">&#9432;</span>
);

interface PerformanceDataViewProps {
    data: PerformanceData;
}

const PerformanceDataView: React.FC<PerformanceDataViewProps> = ({ data }) => {
    const [activeSubTab, setActiveSubTab] = useState<PerformanceSubTab>('collected');
    const [filter, setFilter] = useState('');
    const [modalContent, setModalContent] = useState<{ title: string; text: string } | null>(null);

    const handleShowModal = (key: string) => {
        if (DEFINITIONS[key]) {
            setModalContent(DEFINITIONS[key]);
        }
    };

    const filteredCollectionData = useMemo(() => {
        if (!filter) return data.collection;
        return data.collection.filter(row => row.id.toLowerCase().includes(filter.toLowerCase()));
    }, [data.collection, filter]);

    const filteredQualityData = useMemo(() => {
        if (!filter) return data.quality;
        return data.quality.filter(row => row.id.toLowerCase().includes(filter.toLowerCase()));
    }, [data.quality, filter]);

    const renderContent = () => {
        if (activeSubTab === 'collected') {
            return (
                <table className="min-w-full">
                    <thead className="bg-gray-900">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Enumerator ID:</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Needs Review <InfoIcon onClick={() => handleShowModal('needsReview')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Validated <InfoIcon onClick={() => handleShowModal('validated')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Surveys <InfoIcon onClick={() => handleShowModal('totalSurveys')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">% Validated <InfoIcon onClick={() => handleShowModal('percentValidated')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">% Needs Review <InfoIcon onClick={() => handleShowModal('percentNeedsReview')} /></th>
                        </tr>
                    </thead>
                    <tbody className="bg-gray-850">
                        {filteredCollectionData.map(row => (
                            <tr key={row.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{row.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.needsReview}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.validated}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.total}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.percentValidated}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.percentNeedsReview}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        }

        if (activeSubTab === 'quality') {
            return (
                 <table className="min-w-full">
                    <thead className="bg-gray-900">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Enumerator ID:</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg. Active Survey Time (min) <InfoIcon onClick={() => handleShowModal('avgActiveTime')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg. Total Survey Time (min) <InfoIcon onClick={() => handleShowModal('avgTotalTime')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg. DK Rate (%) <InfoIcon onClick={() => handleShowModal('avgDkRate')} /></th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg. Issues per Survey <InfoIcon onClick={() => handleShowModal('avgIssuesPerSurvey')} /></th>
                        </tr>
                    </thead>
                    <tbody className="bg-gray-850">
                        {filteredQualityData.map(row => (
                            <tr key={row.id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{row.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.avgActiveTime}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.avgTotalTime}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.avgDkRate}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.avgIssuesPerSurvey.toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        }
        return null;
    }

    return (
        <div>
            {modalContent && <InfoModal title={modalContent.title} text={modalContent.text} onClose={() => setModalContent(null)} />}
            <h2 className="text-2xl font-semibold mb-4 text-white">Enumerator Performance</h2>
            <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by Enumerator ID..."
                className="w-full px-4 py-2 mb-4 bg-gray-800 border border-gray-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex flex-wrap gap-2 mb-4">
                <SubTabButton<PerformanceSubTab> tabId="collected" activeTab={activeSubTab} onClick={setActiveSubTab}>Survey Collected</SubTabButton>
                <SubTabButton<PerformanceSubTab> tabId="quality" activeTab={activeSubTab} onClick={setActiveSubTab}>Survey Quality</SubTabButton>
            </div>
            <div className="p-4 bg-gray-900/50 border border-gray-700 rounded-lg overflow-x-auto">
                {renderContent()}
            </div>
        </div>
    );
};

export default PerformanceDataView;