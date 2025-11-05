
import React from 'react';
import { SubmissionHistory, JsonPatch } from '../types';

interface HistoryViewerProps {
  history: SubmissionHistory[];
}

const PatchOperation: React.FC<{ op: JsonPatch }> = ({ op }) => {
    let color = 'text-gray-400';
    let symbol = '';
    let text = '';

    switch (op.op) {
        case 'add':
            color = 'text-green-400';
            symbol = '+';
            text = `Added path ${op.path} with value: ${JSON.stringify(op.value)}`;
            break;
        case 'remove':
            color = 'text-red-400';
            symbol = '-';
            text = `Removed path ${op.path}`;
            break;
        case 'replace':
            color = 'text-yellow-400';
            symbol = '~';
            text = `Replaced path ${op.path} with value: ${JSON.stringify(op.value)}`;
            break;
    }

    return (
        <div className={`flex font-mono text-sm ${color}`}>
            <span className="w-4">{symbol}</span>
            <span>{text}</span>
        </div>
    );
};

const HistoryViewer: React.FC<HistoryViewerProps> = ({ history }) => {
  if (history.length === 0) {
    return <div className="p-4 text-center text-gray-500 bg-gray-800 rounded-lg">No edit history found for this submission.</div>;
  }

  return (
    <div className="space-y-4">
      {history.map((entry) => (
        <div key={entry.history_id} className="p-4 bg-gray-800 rounded-lg">
          <div className="pb-3 mb-3 border-b border-gray-700">
            <p className="font-semibold text-white">Change from {new Date(entry.timestamp).toLocaleString()}</p>
            <p className="text-xs font-mono text-gray-500">Deprecated UUID: {entry.deprecated_uuid}</p>
          </div>
          <div className="space-y-1">
            {entry.data_delta.map((op, index) => (
              <PatchOperation key={index} op={op} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default HistoryViewer;