
import React from 'react';
import { QAStatus } from '../types';

interface BadgeProps {
  status: QAStatus;
  size?: 'sm' | 'lg';
}

const statusStyles: Record<QAStatus, string> = {
  [QAStatus.HFC_FLAGGED]: 'bg-red-800 text-red-200',
  [QAStatus.PENDING_RE_QA]: 'bg-yellow-800 text-yellow-200',
  [QAStatus.PENDING_QA]: 'bg-blue-800 text-blue-200',
  [QAStatus.APPROVED]: 'bg-green-800 text-green-200',
};

const statusText: Record<QAStatus, string> = {
  [QAStatus.HFC_FLAGGED]: 'Flagged',
  [QAStatus.PENDING_RE_QA]: 'Re-QA Pending',
  [QAStatus.PENDING_QA]: 'QA Pending',
  [QAStatus.APPROVED]: 'Approved',
};

export const Badge: React.FC<BadgeProps> = ({ status, size = 'sm' }) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span className={`inline-flex items-center font-semibold rounded-full ${sizeClasses} ${statusStyles[status]}`}>
      {statusText[status]}
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