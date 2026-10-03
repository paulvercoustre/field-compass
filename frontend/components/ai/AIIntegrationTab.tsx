import React, { useCallback, useEffect, useState } from 'react';
import { AccountAIUsage, getAccountAIUsage } from '../../services/aiConnectionsApi';
import AIKeysSection from './AIKeysSection';
import AIOverviewSection from './AIOverviewSection';
import AIUsageSection from './AIUsageSection';

/**
 * Account settings › AI integration: what AI does here and what is
 * included, your keys, and usage. Usage is read once and again whenever a key
 * or the surveys using it change.
 */
const AIIntegrationTab: React.FC = () => {
  const [usage, setUsage] = useState<AccountAIUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    getAccountAIUsage()
      .then((result) => {
        setUsage(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load AI use.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <AIOverviewSection usage={usage} />
      <AIKeysSection
        onChange={() => {
          load();
          setRefreshKey((key) => key + 1);
        }}
      />
      <AIUsageSection usage={usage} error={error} refreshKey={refreshKey} />
    </>
  );
};

export default AIIntegrationTab;
