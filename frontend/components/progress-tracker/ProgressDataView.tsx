
import React, { useState, useMemo } from 'react';
import { ProgressData } from '../../types';
import ProgressBar from './ProgressBar';
import { SubTabButton } from '../ui/SubTabButton';

type ProgressSubTab = 'overall' | 'by-first' | 'by-second' | 'detailed';

interface ProgressDataViewProps {
    data: ProgressData;
}

const ProgressDataView: React.FC<ProgressDataViewProps> = ({ data }) => {
    // Get column names from sampling columns
    const firstColumnName = data.samplingColumns[0] || 'Sampling Column 1';
    const secondColumnName = data.samplingColumns[1] || 'Sampling Column 2';
    
    // Determine default tab based on available data
    const hasFirstColumn = data.byDistrict.length > 0;
    const hasSecondColumn = data.byLivelihood.length > 0;
    const hasDetailed = data.detailed.length > 0;
    
    const getDefaultTab = (): ProgressSubTab => {
        if (hasDetailed) return 'detailed';
        if (hasFirstColumn) return 'by-first';
        if (hasSecondColumn) return 'by-second';
        return 'overall';
    };
    
    const [activeSubTab, setActiveSubTab] = useState<ProgressSubTab>(getDefaultTab());
    const [filter, setFilter] = useState('');

    const filteredDetailedData = useMemo(() => {
        if (!filter) return data.detailed;
        const lowercasedFilter = filter.toLowerCase();
        return data.detailed.filter(row =>
            row.district.toLowerCase().includes(lowercasedFilter) ||
            row.livelihood.toLowerCase().includes(lowercasedFilter)
        );
    }, [data.detailed, filter]);
    
    const renderContent = () => {
        switch (activeSubTab) {
            case 'overall':
                return (
                    <table className="min-w-full">
                        <thead className="bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Interviews</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress (%)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-850">
                            <tr>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{data.overall.conducted}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{data.overall.target}</td>
                                <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={data.overall.progress} /></td>
                            </tr>
                        </tbody>
                    </table>
                );
            case 'by-first':
                 return (
                    <table className="min-w-full">
                        <thead className="bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{firstColumnName}</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Interviews</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress (%)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-850">
                            {data.byDistrict.map(row => (
                                <tr key={row.district}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{row.district}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.conducted}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.target}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={row.progress} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                );
            case 'by-second':
                return (
                    <table className="min-w-full">
                        <thead className="bg-gray-900">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{secondColumnName}</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Interviews</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress (%)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-850">
                            {data.byLivelihood.map(row => (
                                <tr key={row.livelihood}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{row.livelihood}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.conducted}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.target}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={row.progress} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                );
            case 'detailed':
                return (
                    <>
                        <input
                            type="text"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder={`Filter by ${firstColumnName} or ${secondColumnName}...`}
                            className="w-full px-4 py-2 mb-4 bg-gray-800 border border-gray-700 rounded-md placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="overflow-x-auto rounded-lg shadow-md">
                            <table className="min-w-full">
                                <thead className="bg-gray-900">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{firstColumnName}</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{secondColumnName}</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Interviews</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Progress (%)</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-gray-850">
                                    {filteredDetailedData.map((row, index) => (
                                        <tr key={`${row.district}-${row.livelihood}-${index}`}>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{row.district}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{row.livelihood}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300 text-center">{row.target}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300 text-center">{row.conducted}</td>
                                            <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={row.progress} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                );
        }
    };

    return (
        <div>
            <h3 className="text-xl font-bold mb-4 text-white">Data Collection Progress</h3>
            <div className="flex flex-wrap gap-2 mb-4">
                <SubTabButton<ProgressSubTab> tabId="overall" activeTab={activeSubTab} onClick={setActiveSubTab}>Overall</SubTabButton>
                {hasFirstColumn && (
                    <SubTabButton<ProgressSubTab> tabId="by-first" activeTab={activeSubTab} onClick={setActiveSubTab}>
                        By {firstColumnName}
                    </SubTabButton>
                )}
                {hasSecondColumn && (
                    <SubTabButton<ProgressSubTab> tabId="by-second" activeTab={activeSubTab} onClick={setActiveSubTab}>
                        By {secondColumnName}
                    </SubTabButton>
                )}
                {hasDetailed && (
                    <SubTabButton<ProgressSubTab> tabId="detailed" activeTab={activeSubTab} onClick={setActiveSubTab}>Detailed</SubTabButton>
                )}
            </div>
            <div className="p-4 bg-gray-900/50 border border-gray-700 rounded-lg overflow-x-auto">
                {renderContent()}
            </div>
        </div>
    );
};

export default ProgressDataView;