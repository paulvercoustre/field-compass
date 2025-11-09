
import React from 'react';
import { QAStatus } from '../types';

interface BadgeProps {
  status: QAStatus | string;  // Allow string for backward compatibility with old status values
  size?: 'sm' | 'lg';
}

// Extended status map to handle both new and old status values
const statusStyles: Record<string, string> = {
  [QAStatus.PENDING_APPROVAL]: 'bg-blue-800 text-blue-200',
  [QAStatus.FLAGGED]: 'bg-red-800 text-red-200',
  [QAStatus.APPROVED]: 'bg-green-800 text-green-200',
  [QAStatus.REJECTED]: 'bg-orange-800 text-orange-200',
  // Backward compatibility with old status values
  'HFC_FLAGGED': 'bg-red-800 text-red-200',
  'PENDING_QA': 'bg-blue-800 text-blue-200',
  'PENDING_RE_QA': 'bg-yellow-800 text-yellow-200',
};

const statusText: Record<string, string> = {
  [QAStatus.PENDING_APPROVAL]: 'Pending Approval',
  [QAStatus.FLAGGED]: 'Flagged',
  [QAStatus.APPROVED]: 'Approved',
  [QAStatus.REJECTED]: 'Rejected',
  // Backward compatibility with old status values
  'HFC_FLAGGED': 'Flagged',
  'PENDING_QA': 'Pending Approval',
  'PENDING_RE_QA': 'Re-QA Pending',
};

export const Badge: React.FC<BadgeProps> = ({ status, size = 'sm' }) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  const style = statusStyles[status] || 'bg-gray-800 text-gray-200';
  const text = statusText[status] || status;
  return (
    <span className={`inline-flex items-center font-semibold rounded-full ${sizeClasses} ${style}`}>
      {text}
    </span>
  );
};

export const EditIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" />
    </svg>
);

export const AlertIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);