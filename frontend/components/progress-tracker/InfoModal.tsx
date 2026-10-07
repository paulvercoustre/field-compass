import React from 'react';

interface InfoModalProps {
  title: string;
  text: string;
  onClose: () => void;
}

const InfoModal: React.FC<InfoModalProps> = ({ title, text, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-popover p-6 w-full max-w-md border border-gray-200 dark:border-gray-800 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl font-bold"
          >
            &times;
          </button>
        </div>
        <p className="text-gray-700 dark:text-gray-300">{text}</p>
      </div>
    </div>
  );
};

export default InfoModal;
