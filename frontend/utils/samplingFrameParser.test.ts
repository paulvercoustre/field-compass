import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSamplingFrame } from './samplingFrameParser';

const file = (content: BlobPart, name: string) => new File([content], name);

describe('parseSamplingFrame', () => {
  it('reads the first sheet of an .xlsx: headers, then one row per non-empty line', async () => {
    const xlsx = readFileSync(resolve(__dirname, '__fixtures__/sampling-frame.xlsx'));
    const frame = await parseSamplingFrame(file(xlsx, 'Frame.XLSX'));

    expect(frame.headers).toEqual(['district', 'village', 'target', 'visit_date']);
    expect(frame.rows).toEqual([
      { district: 'Kabul', village: 'Deh Sabz', target: 40, visit_date: '2025-10-01' },
      // An empty cell keeps its column, so the first row names every column.
      { district: 'Herat', village: '', target: 25, visit_date: '' },
    ]);
  });

  it('reads a CSV: quoted commas, Windows line ends, malformed rows skipped', async () => {
    const csv = 'district,village,target\r\n"Kabul, city",Deh Sabz,40\r\nHerat,,25\r\nbroken,row\r\n\r\n';
    const frame = await parseSamplingFrame(file(csv, 'frame.csv'));

    expect(frame.headers).toEqual(['district', 'village', 'target']);
    expect(frame.rows).toEqual([
      { district: 'Kabul, city', village: 'Deh Sabz', target: '40' },
      { district: 'Herat', village: '', target: '25' },
    ]);
  });

  it('asks for an old .xls as .xlsx or CSV', async () => {
    await expect(parseSamplingFrame(file('binary', 'frame.xls'))).rejects.toThrow(/\.xls.*\.xlsx or CSV/);
  });

  it('says when a file is empty', async () => {
    await expect(parseSamplingFrame(file('\n\n', 'frame.csv'))).rejects.toThrow('CSV file is empty.');
  });
});
