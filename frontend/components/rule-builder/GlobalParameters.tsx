
import React from 'react';
import { GlobalParameters } from '../../types';

interface GlobalParametersFormProps {
  params: GlobalParameters;
  onParamsChange: (params: GlobalParameters) => void;
}

const GlobalParametersForm: React.FC<GlobalParametersFormProps> = ({ params, onParamsChange }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    onParamsChange({
      ...params,
      [name]: type === 'number' ? (value === '' ? null : Number(value)) : value,
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
      <div className="flex flex-col">
        <label htmlFor="start-date" className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-400">Data Collection Start Date</label>
        <input
          type="date"
          id="start-date"
          name="data_collection_start_date"
          value={params.data_collection_start_date}
          onChange={handleChange}
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="end-date" className="mb-1 text-sm font-medium text-gray-400">Data Collection End Date</label>
        <input
          type="date"
          id="end-date"
          name="data_collection_end_date"
          value={params.data_collection_end_date}
          onChange={handleChange}
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="min-duration" className="mb-1 text-sm font-medium text-gray-400">Minimum Survey Duration (minutes)</label>
        <input
          type="number"
          id="min-duration"
          name="min_survey_duration_minutes"
          value={params.min_survey_duration_minutes ?? ''}
          onChange={handleChange}
          placeholder="e.g., 5"
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="max-duration" className="mb-1 text-sm font-medium text-gray-400">Maximum Survey Duration (minutes)</label>
        <input
          type="number"
          id="max-duration"
          name="max_survey_duration_minutes"
          value={params.max_survey_duration_minutes ?? ''}
          onChange={handleChange}
          placeholder="e.g., 90"
          className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>
    </div>
  );
};

export default GlobalParametersForm;