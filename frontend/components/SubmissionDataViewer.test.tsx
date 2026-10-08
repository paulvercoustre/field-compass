import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SurveyConfig } from '../services/progressApi';
import SubmissionDataViewer from './SubmissionDataViewer';

vi.mock('./transcription/AudioAnswers', () => ({
  Player: () => null,
  RecordingDetails: () => null,
  RecordingStatus: () => null,
}));
vi.mock('./translation/TranslationBlock', () => ({ TranslationBlock: () => null }));

const label = (text: string) => ({ 'label::English (en)': text });

const config = {
  survey_id: 's',
  survey_name: 'S',
  kobo_asset_id: null,
  config_data: {
    kobo_tool: {
      survey: [
        { name: 'start', type: 'start', roster_name: null },
        { name: 'water', type: 'select_one', list_name: 'water', roster_name: null, ...label('Main water source') },
        { name: 'assets', type: 'select_multiple', list_name: 'assets', roster_name: null, ...label('Assets owned') },
        { name: 'crop', type: 'select_one', list_name: 'crops', roster_name: null, ...label('Main crop') },
        { name: 'province', type: 'select_one', list_name: 'provinces', roster_name: null, ...label('Province') },
        {
          name: 'district',
          type: 'select_one',
          list_name: 'districts',
          choice_filter: 'province=${province}',
          roster_name: null,
          ...label('District in **${province}**'),
        },
      ],
      choices: [
        { list_name: 'water', name: 'piped', ...label('Piped water') },
        { list_name: 'water', name: 'well', ...label('Protected well') },
        { list_name: 'assets', name: 'radio', ...label('Radio') },
        { list_name: 'assets', name: 'phone', ...label('Phone') },
        { list_name: 'assets', name: 'bike', ...label('Bicycle') },
        { list_name: 'provinces', name: 'kabul', ...label('Kabul') },
        { list_name: 'provinces', name: 'herat', ...label('Herat') },
        { list_name: 'districts', name: 'kabul_city', province: 'kabul', ...label('Kabul city') },
        { list_name: 'districts', name: 'paghman', province: 'kabul', ...label('Paghman') },
        { list_name: 'districts', name: 'herat_city', province: 'herat', ...label('Herat city') },
        ...['maize', 'rice', 'wheat', 'sorghum', 'millet', 'beans', 'cassava', 'potato'].map((name) => ({
          list_name: 'crops',
          name,
          ...label(name.charAt(0).toUpperCase() + name.slice(1)),
        })),
      ],
    },
  },
} as unknown as SurveyConfig;

const options = (view: ReturnType<typeof render>, question: string) =>
  Array.from(view.getByText(question).parentElement!.querySelectorAll('li')).map((li) => li.textContent);

describe('SubmissionDataViewer select answers', () => {
  afterEach(cleanup);

  it('lists every option, marking the chosen ones, and leaves out form metadata', () => {
    const view = render(
      <SubmissionDataViewer
        data={{ start: '2026-09-28T10:00:00', water: 'well', assets: 'radio bike', crop: 'rice' }}
        surveyConfig={config}
      />
    );
    expect(options(view, 'Main water source')).toEqual(['Piped water', 'Protected well (chosen)']);
    expect(options(view, 'Assets owned')).toEqual(['Radio (chosen)', 'Phone', 'Bicycle (chosen)']);
    expect(view.queryByText('start')).toBeNull();
  });

  it('folds a long list to the chosen options until asked', () => {
    const view = render(<SubmissionDataViewer data={{ crop: 'rice' }} surveyConfig={config} />);
    expect(options(view, 'Main crop')).toEqual(['Rice (chosen)']);
    fireEvent.click(view.getByRole('button', { name: 'Show all 8 options' }));
    expect(options(view, 'Main crop')).toHaveLength(8);
  });

  it('fills references in labels and shows only the options offered', () => {
    const view = render(
      <SubmissionDataViewer data={{ province: 'kabul', district: 'paghman' }} surveyConfig={config} />
    );
    const heading = view.getByText('Kabul', { selector: 'strong' });
    expect(heading.parentElement!.textContent).toBe('District in Kabul');
    expect(options(view, 'District in')).toEqual(['Kabul city', 'Paghman (chosen)']);
  });

  it('keeps a chosen option the filter would no longer offer', () => {
    const view = render(
      <SubmissionDataViewer data={{ province: 'kabul', district: 'herat_city' }} surveyConfig={config} />
    );
    expect(options(view, 'District in')).toEqual(['Kabul city', 'Paghman', 'Herat city (chosen)']);
  });

  it('folds the whole list when the filter can’t be followed', () => {
    const old = structuredClone(config);
    // Saved before choice columns were kept.
    old.config_data.kobo_tool!.choices = old.config_data.kobo_tool!.choices.map(({ province: _p, ...rest }) => rest);
    const view = render(<SubmissionDataViewer data={{ province: 'kabul', district: 'paghman' }} surveyConfig={old} />);
    expect(options(view, 'District in')).toEqual(['Paghman (chosen)']);
    fireEvent.click(view.getByRole('button', { name: 'Show all 3 options in the list' }));
    expect(options(view, 'District in')).toHaveLength(3);
    expect(view.getByText(/Refresh the form in Settings/)).toBeTruthy();
  });
});

describe('SubmissionDataViewer group titles', () => {
  afterEach(cleanup);

  const grouped = {
    survey_id: 's',
    survey_name: 'S',
    kobo_asset_id: null,
    config_data: {
      kobo_tool: {
        label_column_survey: 'label::French (fr)',
        survey: [
          {
            name: 'resp_age',
            type: 'integer',
            roster_name: null,
            group_path: 'hh',
            'label::French (fr)': 'Âge',
            'group_label::English (en)': 'Household',
            'group_label::French (fr)': '**Ménage**',
          },
          { name: 'crop', type: 'text', roster_name: null, group_path: 'hh/grp_livelihoods', ...label('Main crop') },
          { name: 'notes', type: 'text', roster_name: null, group_path: 'hh', ...label('Notes') },
        ],
        choices: [],
      },
    },
  } as unknown as SurveyConfig;

  it('titles each group with its label in the survey’s language, or its name tidied', () => {
    const view = render(
      <SubmissionDataViewer data={{ resp_age: 30, crop: 'rice', notes: 'ok' }} surveyConfig={grouped} />
    );
    const titles = Array.from(view.container.querySelectorAll('h4')).map((h) => h.textContent);
    // A form saved before group labels were kept falls back on the group's name.
    expect(titles).toEqual(['Ménage', 'Livelihoods', 'HH']);
  });
});

describe('SubmissionDataViewer notes', () => {
  afterEach(cleanup);

  const withNotes = {
    survey_id: 's',
    survey_name: 'S',
    kobo_asset_id: null,
    config_data: {
      kobo_tool: {
        survey: [
          { name: 'consent', type: 'select_one', list_name: 'yn', roster_name: null, ...label('Consent?') },
          { name: 'intro_note', type: 'note', roster_name: null, ...label('Read aloud: **thank** the respondent.') },
          { name: 'hh_size', type: 'integer', roster_name: null, ...label('Household size') },
          { name: 'total_note', type: 'note', roster_name: null, ...label('So ${hh_size} people live here.') },
          {
            name: 'refused_note',
            type: 'note',
            relevant: "${consent} = 'no'",
            roster_name: null,
            ...label('End the interview.'),
          },
          { name: 'bare_note', type: 'note', roster_name: null },
        ],
        choices: [
          { list_name: 'yn', name: 'yes', ...label('Yes') },
          { list_name: 'yn', name: 'no', ...label('No') },
        ],
      },
    },
  } as unknown as SurveyConfig;

  it('shows the notes the enumerator saw, filled in, without counting them as answers', () => {
    const view = render(
      <SubmissionDataViewer data={{ consent: 'yes', hh_size: 6 }} surveyConfig={withNotes} findings={[]} />
    );
    const text = view.container.textContent ?? '';
    expect(text).toContain('Note: Read aloud: thank the respondent.');
    expect(view.getByText('thank', { selector: 'strong' })).toBeTruthy();
    expect(text).toContain('So 6 people live here.');
    // Its condition says it wasn't shown; and a note with no text says nothing.
    expect(text).not.toContain('End the interview.');
    expect(text).not.toContain('bare_note');
  });
});
