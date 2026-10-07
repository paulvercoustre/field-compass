import React, { useCallback, useEffect, useState } from 'react';
import FieldLabel from './FieldLabel';
import { Spinner } from '../Spinner';
import { useAuth } from '../../contexts/AuthContext';
import { useActivity } from '../../contexts/ActivityContext';
import { KoboProject, listKoboProjects } from '../../services/api';
import { parseKoboAssetId, looksLikeUrl } from '../../utils/koboUrl';
import { KOBO_LINK_HINT } from '../../constants/coreIdentifiers';

interface KoboProjectPickerProps {
  /** A project ID picked from the list, or whatever was pasted in link mode. */
  value: string;
  /** `project` is set when the value was picked from the list. */
  onChange: (value: string, project?: KoboProject) => void;
}

const STATUS_GROUPS: Array<{ status: KoboProject['status']; label: string }> = [
  { status: 'deployed', label: 'Deployed' },
  { status: 'draft', label: 'Drafts (not deployed yet)' },
  { status: 'archived', label: 'Archived' },
];

const inputClass =
  'w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md shadow-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60';
const linkButtonClass =
  'text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-medium';

const optionText = (project: KoboProject): string => {
  const parts = [project.name];
  if (project.status === 'deployed' && project.submission_count !== null) {
    parts.push(`${project.submission_count} ${project.submission_count === 1 ? 'submission' : 'submissions'}`);
  }
  if (project.existing_survey_name) parts.push('already in Field Compass');
  return parts.join(' · ');
};

/**
 * Picks the Kobo project a new survey reads, from the projects in the user's
 * own Kobo account.
 *
 * Choosing by name replaces opening Kobo, finding the project and copying its
 * address across. Pasting a link stays available: for a project the list does
 * not show, and for when the list cannot be loaded at all.
 */
const KoboProjectPicker: React.FC<KoboProjectPickerProps> = ({ value, onChange }) => {
  const { user } = useAuth();
  const { navigate } = useActivity();
  const hasKey = Boolean(user?.has_kobo_api_key);

  const [projects, setProjects] = useState<KoboProject[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Without a key there is no list to choose from, so links are the only way.
  const [mode, setMode] = useState<'list' | 'link'>(hasKey ? 'list' : 'link');

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setProjects(await listKoboProjects());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your Kobo projects.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasKey) loadProjects();
  }, [hasKey, loadProjects]);

  const switchMode = (next: 'list' | 'link') => {
    // A value entered in the other mode is not visible in this one, so it
    // must not stay selected behind the user's back.
    onChange('');
    setMode(next);
  };

  const selected = projects?.find((project) => project.uid === value) ?? null;
  const assetId = parseKoboAssetId(value);

  const addKeyPrompt = (
    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
      <button type="button" onClick={() => navigate({ view: 'userSettings', tab: 'kobo' })} className={linkButtonClass}>
        Add your Kobo API key
      </button>{' '}
      to choose from your projects instead.
    </p>
  );

  if (mode === 'link') {
    return (
      <div>
        <FieldLabel hint={KOBO_LINK_HINT}>Kobo project link *</FieldLabel>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder="https://kf.kobotoolbox.org/#/forms/aXXXXXXXXXXXXXXXXXXXXX"
          required
        />
        {assetId ? (
          <p className="mt-1 text-xs text-green-600 dark:text-green-400">
            ✓ Project ID: <span className="font-mono">{assetId}</span>
          </p>
        ) : value.trim() ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {looksLikeUrl(value)
              ? 'That link does not contain a project ID. Open your project in Kobo and copy the address bar.'
              : 'That is not a Kobo project link or ID.'}
          </p>
        ) : null}
        {hasKey ? (
          <p className="mt-1 text-xs">
            <button type="button" onClick={() => switchMode('list')} className={linkButtonClass}>
              Choose from your Kobo projects
            </button>
          </p>
        ) : (
          addKeyPrompt
        )}
      </div>
    );
  }

  return (
    <div>
      <FieldLabel hint="The projects your Kobo account owns or has been shared.">Kobo project *</FieldLabel>

      {isLoading ? (
        <div className={`${inputClass} flex items-center gap-2 text-gray-500 dark:text-gray-400`}>
          <Spinner size="sm" className="text-current" />
          <span>Loading your Kobo projects...</span>
        </div>
      ) : loadError ? (
        <div className="p-3 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-800 dark:text-red-200">
          <p>{loadError}</p>
          <p className="mt-2 flex gap-4">
            <button type="button" onClick={loadProjects} className={linkButtonClass}>
              Try again
            </button>
            <button type="button" onClick={() => switchMode('link')} className={linkButtonClass}>
              Paste a project link
            </button>
          </p>
        </div>
      ) : projects && projects.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Your Kobo account has no survey projects yet. Create one in Kobo, then{' '}
          <button type="button" onClick={loadProjects} className={linkButtonClass}>
            refresh the list
          </button>
          .
        </p>
      ) : (
        <select
          value={selected ? selected.uid : ''}
          onChange={(e) => {
            const project = projects?.find((p) => p.uid === e.target.value);
            onChange(e.target.value, project);
          }}
          className={inputClass}
          required
        >
          <option value="">Select a project</option>
          {STATUS_GROUPS.map(({ status, label }) => {
            const inGroup = (projects || []).filter((project) => project.status === status);
            if (inGroup.length === 0) return null;
            return (
              <optgroup key={status} label={label}>
                {inGroup.map((project) => (
                  <option key={project.uid} value={project.uid}>
                    {optionText(project)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}

      {selected?.status === 'draft' && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          This form is not deployed in Kobo yet, so there are no submissions to check until it is.
        </p>
      )}
      {selected?.status === 'archived' && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          This project is archived in Kobo, so it no longer receives submissions.
        </p>
      )}
      {selected?.existing_survey_name && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          “{selected.existing_survey_name}” already reads this project.
        </p>
      )}

      {!loadError && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Not in the list?{' '}
          <button type="button" onClick={loadProjects} disabled={isLoading} className={linkButtonClass}>
            Refresh
          </button>{' '}
          or{' '}
          <button type="button" onClick={() => switchMode('link')} className={linkButtonClass}>
            paste a project link
          </button>
          .
        </p>
      )}
    </div>
  );
};

export default KoboProjectPicker;
