import React from 'react';

interface QualityCheckPromptModalProps {
  onConfigureNow: () => void;
  onConfigureLater: () => void;
}

const QualityCheckPromptModal: React.FC<QualityCheckPromptModalProps> = ({ 
  onConfigureNow, 
  onConfigureLater 
}) => {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]"
      onClick={onConfigureLater}
    >
      <div 
        className="bg-white dark:bg-gray-900 rounded-xl shadow-popover p-6 w-full max-w-md border border-gray-200 dark:border-gray-800 animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
            Configure Data Quality Checks
          </h3>
          <button 
            onClick={onConfigureLater} 
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl font-bold"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        
        <p className="text-gray-700 dark:text-gray-300 mb-6">
          Your survey has been created successfully! Would you like to configure data quality checks now, or set them up later?
        </p>
        
        <div className="flex gap-3 justify-end">
          <button
            onClick={onConfigureLater}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
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


