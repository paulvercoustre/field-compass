import React from 'react';

interface QualityCheckPromptModalProps {
  onConfigureNow: () => void;
  onConfigureLater: () => void;
}

const QualityCheckPromptModal: React.FC<QualityCheckPromptModalProps> = ({ onConfigureNow, onConfigureLater }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]"
      onClick={onConfigureLater}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-popover p-6 w-full max-w-md border border-gray-200 dark:border-gray-800 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
            Set up quality checks
          </h3>
          <button
            onClick={onConfigureLater}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl font-bold"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-gray-700 dark:text-gray-300 mb-6">Survey created. Set up its quality checks now?</p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onConfigureLater}
            className="h-8 px-3 text-sm font-medium bg-white text-gray-900 border border-gray-300 shadow-xs rounded-md hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 transition-colors"
          >
            Later
          </button>
          <button
            onClick={onConfigureNow}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-500 transition-colors"
          >
            Configure Now
          </button>
        </div>
      </div>
    </div>
  );
};

export default QualityCheckPromptModal;
