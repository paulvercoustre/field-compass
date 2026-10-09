import { useState } from 'react';
import type { SectionControls } from '../components/settings/SectionControls';

type Flags<S extends string> = Partial<Record<S, boolean>>;

interface SectionEditorOptions<S extends string> {
  /** Save one section; throws the save's error. */
  save: (section: S) => Promise<void>;
  /** Put one section's fields back as last saved. */
  restore: (section: S) => void;
  /** Show (or, with null, clear) a save error. */
  onError: (message: string | null) => void;
}

/**
 * Saving and cancelling the sections of a settings page. Every section can be
 * changed as it stands, with no Edit step: Save and Cancel show once it
 * differs from what is saved, which each section works out for itself.
 */
export function useSectionEditor<S extends string>({ save, restore, onError }: SectionEditorOptions<S>) {
  const [saving, setSaving] = useState<Flags<S>>({});

  /** Save a section; on failure its changes stay, with the error shown. */
  const saveSection = async (section: S) => {
    setSaving((prev) => ({ ...prev, [section]: true }));
    onError(null);
    try {
      await save(section);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving((prev) => ({ ...prev, [section]: false }));
    }
  };

  /** One section's state and actions, for its buttons; `dirty` is whether it differs from what is saved. */
  const controls = (section: S, dirty: boolean): SectionControls => ({
    dirty,
    saving: saving[section] === true,
    save: () => saveSection(section),
    cancel: () => restore(section),
  });

  return { controls };
}
