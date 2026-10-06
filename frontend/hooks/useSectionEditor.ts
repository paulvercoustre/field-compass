import { useCallback, useState } from 'react';
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
 * Which sections of a settings page are being edited and which are saving.
 * A section either opens with an Edit button or is always editable with
 * Save shown once it changes; both kinds save and cancel the same way.
 */
export function useSectionEditor<S extends string>({ save, restore, onError }: SectionEditorOptions<S>) {
  const [editing, setEditing] = useState<Flags<S>>({});
  const [saving, setSaving] = useState<Flags<S>>({});

  const edit = useCallback((section: S) => setEditing((prev) => ({ ...prev, [section]: true })), []);
  const close = (section: S) => setEditing((prev) => ({ ...prev, [section]: false }));

  /** Save a section and close it; on failure it stays open with the error shown. */
  const saveSection = async (section: S) => {
    setSaving((prev) => ({ ...prev, [section]: true }));
    onError(null);
    try {
      await save(section);
      close(section);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving((prev) => ({ ...prev, [section]: false }));
    }
  };

  const cancel = (section: S) => {
    close(section);
    restore(section);
  };

  /** Close every section, e.g. when another survey is chosen. */
  const closeAll = useCallback(() => setEditing({}), []);

  const isEditing = (section: S) => editing[section] === true;
  const isSaving = (section: S) => saving[section] === true;

  return {
    isEditing,
    isSaving,
    edit,
    save: saveSection,
    cancel,
    closeAll,
    /** One section's state and actions, for its buttons. */
    controls: (section: S): SectionControls => ({
      editing: isEditing(section),
      saving: isSaving(section),
      edit: () => edit(section),
      save: () => saveSection(section),
      cancel: () => cancel(section),
    }),
  };
}
