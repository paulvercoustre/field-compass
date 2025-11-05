
import { Submission, SubmissionHistory, QAStatus } from '../types';

const MOCK_SUBMISSIONS: Submission[] = [
  {
    _id: 1001,
    _uuid: 'uuid-1001-v2',
    _submission_time: '2023-10-26T10:00:00Z',
    end: '2023-10-27T14:35:10Z',
    submission_data: {
      name: 'John Doe',
      age: 99,
      income: 150000,
      has_children: true,
      q_children_count: 2,
      q_roster_children: [
        { child_name: 'Jane', child_age: 5 },
        { child_name: 'Jim', child_age: 8 },
      ]
    },
    is_edited: true,
    data_quality_issues: [
      { check: 'Outlier', field: 'age', value: 99, message: 'Age 99 is above the 95th percentile (90).' },
      { check: 'Outlier', field: 'income', value: 150000, message: 'Income 150000 is above the 95th percentile (120000).' }
    ],
    qa_status: QAStatus.HFC_FLAGGED,
  },
  {
    _id: 1002,
    _uuid: 'uuid-1002-v1',
    _submission_time: '2023-10-27T11:00:00Z',
    end: '2023-10-27T11:05:00Z',
    submission_data: {
      name: 'Alice',
      age: 45,
      income: 75000,
      has_children: true,
      q_children_count: 1,
      q_roster_children: []
    },
    is_edited: false,
    data_quality_issues: [
       { check: 'Internal Consistency', field: 'q_children_count', value: 1, message: 'q_children_count is > 0 but child roster is empty.' }
    ],
    qa_status: QAStatus.HFC_FLAGGED,
  },
    {
    _id: 1003,
    _uuid: 'uuid-1003-v2',
    _submission_time: '2023-10-25T09:00:00Z',
    end: '2023-10-27T15:00:00Z',
    submission_data: {
      name: 'Bob',
      age: 34,
      income: 60000,
      has_children: false,
      q_children_count: 0,
      q_roster_children: []
    },
    is_edited: true,
    data_quality_issues: [],
    qa_status: QAStatus.PENDING_RE_QA,
  },
  {
    _id: 1004,
    _uuid: 'uuid-1004-v1',
    _submission_time: '2023-10-27T12:00:00Z',
    end: '2023-10-27T12:04:00Z',
    submission_data: {
      name: 'Charlie',
      age: 28,
      income: 50000,
      has_children: false,
      q_children_count: 0,
      q_roster_children: []
    },
    is_edited: false,
    data_quality_issues: [],
    qa_status: QAStatus.PENDING_QA,
  },
  {
    _id: 1005,
    _uuid: 'uuid-1005-v1',
    _submission_time: '2023-10-26T18:00:00Z',
    end: '2023-10-26T18:03:00Z',
    submission_data: {
      name: 'Diana',
      age: 52,
      income: 95000,
      has_children: true,
      q_children_count: 1,
      q_roster_children: [{ child_name: 'Eve', child_age: 15 }]
    },
    is_edited: false,
    data_quality_issues: [],
    qa_status: QAStatus.APPROVED,
  }
];

const MOCK_HISTORY: Record<number, SubmissionHistory[]> = {
  1001: [
    {
      history_id: 201,
      kobo_id: 1001,
      timestamp: '2023-10-27T14:35:10Z',
      deprecated_uuid: 'uuid-1001-v1',
      data_delta: [
        { op: 'replace', path: '/age', value: 99 },
        { op: 'replace', path: '/income', value: 150000 },
        { op: 'add', path: '/q_roster_children/1', value: { child_name: 'Jim', child_age: 8 } }
      ]
    }
  ],
  1003: [
    {
      history_id: 202,
      kobo_id: 1003,
      timestamp: '2023-10-27T15:00:00Z',
      deprecated_uuid: 'uuid-1003-v1',
      data_delta: [
        { op: 'replace', path: '/income', value: 60000 },
      ]
    }
  ]
};


export const api = {
  getSubmissions: (): Promise<Submission[]> => {
    console.log('API: Fetching submissions...');
    return new Promise(resolve => {
      setTimeout(() => {
        console.log('API: Submissions fetched.');
        resolve(MOCK_SUBMISSIONS);
      }, 500);
    });
  },
  getSubmissionHistory: (koboId: number): Promise<SubmissionHistory[]> => {
    console.log(`API: Fetching history for submission ${koboId}...`);
    return new Promise(resolve => {
      setTimeout(() => {
        const history = MOCK_HISTORY[koboId] || [];
        console.log(`API: History for ${koboId} fetched.`);
        resolve(history);
      }, 300);
    });
  }
};