import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSectionEditor } from './useSectionEditor';

type Section = 'a' | 'b';

const setup = (save: (section: Section) => Promise<void> = async () => {}) => {
  const restore = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useSectionEditor<Section>({ save, restore, onError }));
  return { hook, restore, onError };
};

describe('useSectionEditor', () => {
  it('opens one section at a time and closes it once saved', async () => {
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { hook, onError } = setup(save);

    act(() => hook.result.current.edit('a'));
    expect(hook.result.current.isEditing('a')).toBe(true);
    expect(hook.result.current.isEditing('b')).toBe(false);

    let saving!: Promise<void>;
    act(() => {
      saving = hook.result.current.save('a');
    });
    expect(hook.result.current.isSaving('a')).toBe(true);
    await act(async () => {
      finish();
      await saving;
    });

    expect(save).toHaveBeenCalledWith('a');
    expect(onError).toHaveBeenCalledWith(null);
    expect(hook.result.current.isSaving('a')).toBe(false);
    expect(hook.result.current.isEditing('a')).toBe(false);
  });

  it('keeps a section open and shows the error when its save fails', async () => {
    const { hook, onError } = setup(async () => {
      throw new Error('Kobo said no');
    });

    act(() => hook.result.current.edit('a'));
    await act(() => hook.result.current.save('a'));

    expect(onError).toHaveBeenLastCalledWith('Kobo said no');
    expect(hook.result.current.isEditing('a')).toBe(true);
    expect(hook.result.current.isSaving('a')).toBe(false);
  });

  it('cancelling closes the section and puts its fields back', () => {
    const { hook, restore } = setup();

    act(() => hook.result.current.edit('b'));
    act(() => hook.result.current.cancel('b'));

    expect(hook.result.current.isEditing('b')).toBe(false);
    expect(restore).toHaveBeenCalledWith('b');
  });

  it('closes every section at once', () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.edit('a');
      hook.result.current.edit('b');
    });
    act(() => hook.result.current.closeAll());

    expect(hook.result.current.isEditing('a')).toBe(false);
    expect(hook.result.current.isEditing('b')).toBe(false);
  });
});
