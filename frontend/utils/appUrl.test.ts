import { describe, expect, it } from 'vitest';
import { placeFrom, titleFor, urlFor } from './appUrl';

const at = (url: string) => {
  const parsed = new URL(url, 'https://app.example.org');
  return placeFrom({ pathname: parsed.pathname, search: parsed.search });
};

describe('the app’s address', () => {
  it('names the page, the survey and where in it', () => {
    expect(urlFor({ view: 'qualityOverview', surveyId: 's1' })).toBe('/surveys/s1/quality');
    expect(urlFor({ view: 'settings', surveyId: 's1', tab: 'access' })).toBe('/surveys/s1/settings/access');
    // A page's first tab is left out.
    expect(urlFor({ view: 'settings', surveyId: 's1', tab: 'settings' })).toBe('/surveys/s1/settings');
    expect(urlFor({ view: 'userSettings', tab: 'kobo' })).toBe('/account/kobo');
    expect(urlFor({ view: 'createSurvey', surveyId: 's1' })).toBe('/new');
    // A survey page with no survey is the start.
    expect(urlFor({ view: 'dashboard' })).toBe('/');
  });

  it('carries the queue’s tab, filters and open submission there and back', () => {
    const place = {
      view: 'dashboard' as const,
      surveyId: 's1',
      submissionId: 300163,
      filters: {
        review: 'needs_review' as const,
        issues: ['duration_too_short', 'dk_percentage_high'],
        enumerators: ['enum_03'],
        samplingFilters: [{ variable: 'district', values: ['north', 'south'] }],
        search: 'goats',
        sort: 'oldest' as const,
      },
    };
    const url = urlFor(place);
    expect(url.startsWith('/surveys/s1/submissions/300163?review=needs_review&issue=')).toBe(true);
    expect(at(url)).toEqual(place);
  });

  it('reads an address it doesn’t know as the start, and leaves out what doesn’t fit', () => {
    expect(at('/nowhere')).toEqual({ view: 'dashboard' });
    expect(at('/surveys/s1/submissions/abc?review=nonsense&sort=sideways&issue=a')).toEqual({
      view: 'dashboard',
      surveyId: 's1',
      submissionId: null,
      filters: { issues: ['a'] },
    });
  });

  it('opens an enumerator’s call sheet at its own address', () => {
    const place = { view: 'enumeratorPerformance' as const, surveyId: 's1', tab: 'enum 07' };
    expect(urlFor(place)).toBe('/surveys/s1/team/enum%2007');
    expect(at('/surveys/s1/team/enum%2007')).toEqual(place);
    expect(urlFor({ view: 'enumeratorPerformance', surveyId: 's1' })).toBe('/surveys/s1/team');
    expect(titleFor(place, 'Household 2026')).toBe('enum 07 · Field team · Household 2026 · Field Compass');
  });

  it('titles the browser tab with the page, the submission and the survey', () => {
    expect(titleFor({ view: 'dashboard', submissionId: 300163 }, 'Household 2026')).toBe(
      '#300163 · Submissions · Household 2026 · Field Compass'
    );
    expect(titleFor({ view: 'enumeratorPerformance' }, 'Household 2026')).toBe(
      'Field team · Household 2026 · Field Compass'
    );
    expect(titleFor({ view: 'userSettings' })).toBe('Account settings · Field Compass');
    expect(titleFor({ view: 'qualityOverview' }, null)).toBe('Field Compass');
  });
});
