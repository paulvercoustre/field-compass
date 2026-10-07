import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { KoboToolData } from '../types';
import { useCollectionTargets } from './useCollectionTargets';

vi.mock('../utils/samplingFrameParser', async (original) => ({
  ...(await original<typeof import('../utils/samplingFrameParser')>()),
  parseSamplingFrame: vi.fn(async () => ({
    headers: ['district', 'region_label', 'target'],
    rows: [{ district: 'north', region_label: 'N', target: 10 }],
  })),
}));

const tool = { variableMap: new Map([['district', {}]]) } as unknown as KoboToolData;
const fileEvent = () =>
  ({
    target: { files: [new File(['x'], 'targets.csv')], value: 'targets.csv' },
  }) as unknown as React.ChangeEvent<HTMLInputElement>;

describe('useCollectionTargets', () => {
  it('loads a stored config, inferring the mode a config without one behaves as', () => {
    const { result } = renderHook(() => useCollectionTargets(tool));
    act(() => result.current.load({ sampling_cols: ['district'], frame_data: [{ district: 'north' }] }));
    expect(result.current.settings.mode).toBe('uploaded');
    expect(result.current.frameData).toEqual([{ district: 'north' }]);
  });

  it("drops the old mode's settings when the mode changes", () => {
    const { result } = renderHook(() => useCollectionTargets(tool));
    act(() => result.current.changeMode('by_variable'));
    act(() => result.current.setVariable('district'));
    act(() => result.current.setTargetsByValue({ north: 5 }));
    expect(result.current.settings.sampling_cols).toEqual(['district']);
    act(() => result.current.changeMode('total'));
    expect(result.current.settings).toMatchObject({
      mode: 'total',
      variable: null,
      targets_by_value: {},
      sampling_cols: [],
    });
  });

  it('reads an uploaded file, keeping only the columns that are questions', async () => {
    const { result } = renderHook(() => useCollectionTargets(tool));
    act(() => result.current.changeMode('uploaded'));
    await act(() => result.current.upload(fileEvent()));
    expect(result.current.error).toBeNull();
    expect(result.current.fileName).toBe('targets.csv');
    expect(result.current.settings.sampling_cols).toEqual(['district']);
    expect(result.current.note).toContain('Other columns are ignored: region_label');
    expect(result.current.toConfig().frame_data).toHaveLength(1);
  });

  it('refuses a file before the form is read', async () => {
    const { result } = renderHook(() => useCollectionTargets(null));
    await act(() => result.current.upload(fileEvent()));
    expect(result.current.error).toMatch(/Read the form from your Kobo project first/);
    expect(result.current.frameData).toBeNull();
  });
});
