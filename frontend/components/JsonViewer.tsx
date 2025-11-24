
import React from 'react';

interface JsonViewerProps {
  data: object;
}

const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
  return (
    <div className="min-w-0">
      <pre className="p-4 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg overflow-x-auto text-gray-700 dark:text-gray-300 min-w-0">
        <code className="block min-w-0">
          {JSON.stringify(data, null, 2)}
        </code>
      </pre>
    </div>
  );
};

export default JsonViewer;