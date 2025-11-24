
import React from 'react';

interface InfoModalProps {
  title: string;
  text: string;
  onClose: () => void;
}

const InfoModal: React.FC<InfoModalProps> = ({ title, text, onClose }) => {
  return (
    <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
        onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md border border-gray-200 dark:border-gray-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl font-bold">&times;</button>
        </div>
        <p className="text-gray-700 dark:text-gray-300">{text}</p>
      </div>
    </div>
  );
};

export default InfoModal;