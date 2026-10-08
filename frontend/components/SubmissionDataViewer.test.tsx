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
      ],
      choices: [
        { list_name: 'water', name: 'piped', ...label('Piped water') },
        { list_name: 'water', name: 'well', ...label('Protected well') },
        { list_name: 'assets', name: 'radio', ...label('Radio') },
        { list_name: 'assets', name: 'phone', ...label('Phone') },
        { list_name: 'assets', name: 'bike', ...label('Bicycle') },
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
});
