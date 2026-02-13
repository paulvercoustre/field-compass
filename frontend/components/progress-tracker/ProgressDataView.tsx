
import React, { useMemo } from 'react';
import { ProgressData } from '../../types';
import { SurveyConfig } from '../../services/progressApi';
import { getQuestionInfo, getChoiceLabel } from '../../utils/koboLabelUtils';
import ProgressBar from './ProgressBar';
import { SubTabButton } from '../ui/SubTabButton';

export type ProgressSubTab = 'overall' | string; // string will be column name for "by-{columnName}"

interface ProgressDataViewProps {
    data: ProgressData;
    surveyConfig: SurveyConfig | null;
    approvedOnly?: boolean;
    activeSubTab: ProgressSubTab;
    setActiveSubTab: (tab: ProgressSubTab) => void;
    filter: string;
    setFilter: (filter: string) => void;
}

const ProgressDataView: React.FC<ProgressDataViewProps> = ({ 
    data,
    surveyConfig,
    approvedOnly = false,
    activeSubTab,
    setActiveSubTab,
    filter,
    setFilter
}) => {
    // Get all column names from sampling columns
    const columnNames = data.samplingColumns || [];
    
    // Determine which tabs have data
    const hasColumnTabs = Object.keys(data.byColumn || {}).length > 0;
    const hasDetailed = data.detailed.length > 0;

    /**
     * Resolve a raw Kobo value to its label using the survey config
     * @param colName - The column/variable name from the sampling frame
     * @param value - The raw value to resolve
     * @returns The resolved label, or the original value if label not found
     */
    const resolveLabel = (colName: string, value: string | null | undefined): string => {
        // Handle null/undefined values
        if (value === null || value === undefined) return 'Unknown';
        
        // If no survey config, return raw value
        if (!surveyConfig) return String(value);
        
        // Get question info for this column
        const questionInfo = getQuestionInfo(colName, surveyConfig);
        
        // If no listName (camelCase!), this isn't a select_one/select_multiple question
        // Return raw value
        if (!questionInfo?.listName) return String(value);
        
        // Resolve the choice label
        const label = getChoiceLabel(String(value), questionInfo.listName, surveyConfig);
        
        // Return the label (or raw value if label not found)
        return label;
    };

    // Filter detailed data based on all column values (both raw and label)
    const filteredDetailedData = useMemo(() => {
        if (!filter) return data.detailed;
        const lowercasedFilter = filter.toLowerCase();
        return data.detailed.filter(row => {
            // Check if any column value (or its label) matches the filter
            return Object.entries(row.values || {}).some(([colName, value]) => {
                const rawValue = String(value).toLowerCase();
                const labelValue = resolveLabel(colName, value).toLowerCase();
                return rawValue.includes(lowercasedFilter) || labelValue.includes(lowercasedFilter);
            });
        });
    }, [data.detailed, filter, surveyConfig]);
    
    const renderContent = () => {
        if (activeSubTab === 'overall') {
            return (
                <table className="min-w-full">
                    <thead className="bg-gray-200 dark:bg-gray-900">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Target Interviews</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Progress (%)</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-850">
                        <tr>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{data.overall.conducted}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{data.overall.target}</td>
                            <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={data.overall.progress} /></td>
                        </tr>
                    </tbody>
                </table>
            );
        }
        
        // Check if this is a "by-column" tab
        if (activeSubTab.startsWith('by-')) {
            const columnName = activeSubTab.replace('by-', '');
            const columnData = data.byColumn?.[columnName] || [];
            
            return (
                <table className="min-w-full">
                    <thead className="bg-gray-200 dark:bg-gray-900">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">{columnName}</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Target Interviews</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Progress (%)</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-850">
                        {columnData.map(row => {
                            const displayLabel = resolveLabel(columnName, row.value);
                            return (
                                <tr key={row.value}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{displayLabel}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{row.conducted}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{row.target}</td>
                                    <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={row.progress} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            );
        }
        
        // Detailed view
        if (activeSubTab === 'detailed') {
            const filterPlaceholder = columnNames.length > 0
                ? `Filter by ${columnNames.join(', ')}...`
                : 'Filter...';
            
            return (
                <>
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={filterPlaceholder}
                        className="w-full px-4 py-2 mb-4 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md placeholder-gray-500 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="overflow-x-auto rounded-lg shadow-md">
                        <table className="min-w-full">
                            <thead className="bg-gray-200 dark:bg-gray-900">
                                <tr>
                                    {columnNames.map(colName => (
                                        <th key={colName} className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">
                                            {colName}
                                        </th>
                                    ))}
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Target Interviews</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Interviews Conducted</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase tracking-wider">Progress (%)</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-850">
                                {filteredDetailedData.map((row, index) => {
                                    const rowKey = Object.values(row.values || {}).join('-') + `-${index}`;
                                    return (
                                        <tr key={rowKey}>
                                            {columnNames.map(colName => {
                                                const rawValue = row.values?.[colName];
                                                const displayLabel = resolveLabel(colName, rawValue);
                                                return (
                                                    <td key={colName} className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                                        {displayLabel}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-center">{row.target}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 text-center">{row.conducted}</td>
                                            <td className="px-6 py-4 whitespace-nowrap"><ProgressBar percentage={row.progress} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            );
        }
        
        return null;
    };

    return (
        <div>
            <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Data Collection Progress</h3>
                {approvedOnly && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-100">
                        Approved surveys only
                    </span>
                )}
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
                <SubTabButton<ProgressSubTab> tabId="overall" activeTab={activeSubTab} onClick={setActiveSubTab}>
                    Overall
                </SubTabButton>
                {Object.keys(data.byColumn || {}).map(columnName => {
                    const columnData = data.byColumn[columnName];
                    if (columnData && columnData.length > 0) {
                        return (
                            <SubTabButton<ProgressSubTab>
                                key={columnName}
                                tabId={`by-${columnName}`}
                                activeTab={activeSubTab}
                                onClick={setActiveSubTab}
                            >
                                By {columnName}
                            </SubTabButton>
                        );
                    }
                    return null;
                })}
                {hasDetailed && (
                    <SubTabButton<ProgressSubTab> tabId="detailed" activeTab={activeSubTab} onClick={setActiveSubTab}>
                        Detailed
                    </SubTabButton>
                )}
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
                {renderContent()}
            </div>
        </div>
    );
};

export default ProgressDataView;
