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
  it('saves one section, saying it is saving meanwhile', async () => {
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { hook, onError } = setup(save);

    expect(hook.result.current.controls('a', true).dirty).toBe(true);
    act(() => {
      hook.result.current.controls('a', true).save();
    });
    expect(hook.result.current.controls('a', true).saving).toBe(true);
    expect(hook.result.current.controls('b', false).saving).toBe(false);
    await act(async () => finish());

    expect(save).toHaveBeenCalledWith('a');
    expect(onError).toHaveBeenCalledWith(null);
    expect(hook.result.current.controls('a', false).saving).toBe(false);
  });

  it('shows the error when a save fails', async () => {
    const { hook, onError } = setup(async () => {
      throw new Error('Kobo said no');
    });

    await act(async () => hook.result.current.controls('a', true).save());

    expect(onError).toHaveBeenLastCalledWith('Kobo said no');
    expect(hook.result.current.controls('a', true).saving).toBe(false);
  });

  it('cancelling puts the section’s fields back', () => {
    const { hook, restore } = setup();

    act(() => hook.result.current.controls('b', true).cancel());

    expect(restore).toHaveBeenCalledWith('b');
  });
});
