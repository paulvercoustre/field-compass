
import React from 'react';

interface JsonViewerProps {
  data: object;
}

const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
  return (
    <pre className="p-4 text-sm bg-gray-800 rounded-lg overflow-x-auto text-gray-300">
      <code>
        {JSON.stringify(data, null, 2)}
      </code>
    </pre>
  );
};

export default JsonViewer;