import { describe, expect, it } from 'vitest';
import { editsOf } from './editHistory';

describe('editsOf', () => {
  it('turns a Kobo edit into changed answers, leaving out Kobo’s own fields', () => {
    const [edit] = editsOf([
      {
        history_id: 1,
        timestamp: '2026-10-03T14:35:00Z',
        data_delta: [
          { op: 'replace', path: '/meta~1instanceID', value: 'uuid:2', old: 'uuid:1' },
          { op: 'replace', path: '/_submission_time', value: 'x' },
          { op: 'replace', path: '/end', value: 'y' },
          { op: 'replace', path: '/hh~1hh_size', value: 4, old: 14 },
          { op: 'add', path: '/hh~1resp_age', value: 30 },
          { op: 'remove', path: '/hh~1notes', old: 'two goats' },
          { op: 'replace', path: '/hh_roster/1/hh_roster~1name', value: 'Ana', old: null },
          { op: 'add', path: '/hh_roster/2', value: { 'hh_roster/name': 'Bo' } },
        ],
      },
    ]);
    expect(edit.changes).toEqual([
      { question: 'hh_size', kind: 'changed', before: 14, after: 4 },
      { question: 'resp_age', kind: 'answered', after: 30 },
      { question: 'notes', kind: 'cleared', before: 'two goats' },
      { question: 'name', item: 2, kind: 'changed', after: 'Ana' },
      { question: 'hh_roster', item: 3, kind: 'answered', after: { 'hh_roster/name': 'Bo' } },
    ]);
  });
});
