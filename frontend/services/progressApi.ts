
import { ProgressData, PerformanceData } from '../types';

const MOCK_PROGRESS_DATA: ProgressData = {
  overall: { conducted: 139, target: 135, progress: 103 },
  byDistrict: [
    { district: "Kamdesh (Nuristan)", conducted: 43, target: 45, progress: 95.6 },
    { district: "Sayad (Sar-e-Pul)", conducted: 50, target: 45, progress: 111.1 },
    { district: "Zaranj (Nimroz)", conducted: 46, target: 45, progress: 102.2 },
  ],
  byLivelihood: [
    { livelihood: "Aquaculture/fishing", conducted: 5, target: 5, progress: 100 },
    { livelihood: "Dairy products processing/production", conducted: 11, target: 15, progress: 73.3 },
    { livelihood: "Food shops", conducted: 5, target: 5, progress: 100 },
    { livelihood: "Greenhouse/kitchen gardening", conducted: 14, target: 15, progress: 93.3 },
    { livelihood: "Home kitchen cooking", conducted: 6, target: 5, progress: 120 },
    { livelihood: "Livestock/animal husbandry", conducted: 21, target: 15, progress: 140 },
    { livelihood: "Manufacturing of traditional ovens & stoves", conducted: 0, target: 5, progress: 0 },
    { livelihood: "Opening cafés and restaurants", conducted: 5, target: 5, progress: 100 },
    { livelihood: "Plant nursery", conducted: 6, target: 5, progress: 120 },
    { livelihood: "Poultry", conducted: 17, target: 15, progress: 113.3 },
    { livelihood: "Processing of fruits and vegetables", conducted: 14, target: 15, progress: 93.3 },
    { livelihood: "Production of homemade Oral Rehydration Solution (ORS)", conducted: 0, target: 5, progress: 0 },
    { livelihood: "Purification and sale of safe drinking water", conducted: 4, target: 5, progress: 80 },
    { livelihood: "Soap making", conducted: 3, target: 5, progress: 60 },
    { livelihood: "Tailoring", conducted: 28, target: 15, progress: 186.7 },
  ],
  detailed: [
    { district: "Sayad (Sar-e-Pul)", livelihood: "Greenhouse/kitchen gardening", target: 5, conducted: 4, progress: 80 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Processing of fruits and vegetables", target: 5, conducted: 4, progress: 80 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Livestock/animal husbandry", target: 5, conducted: 11, progress: 220 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Poultry", target: 5, conducted: 7, progress: 140 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Dairy products processing/production", target: 5, conducted: 2, progress: 40 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Tailoring", target: 5, conducted: 18, progress: 360 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Manufacturing of traditional ovens & stoves", target: 5, conducted: 0, progress: 0 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Purification and sale of safe drinking water", target: 5, conducted: 4, progress: 80 },
    { district: "Sayad (Sar-e-Pul)", livelihood: "Production of homemade Oral Rehydration Solution (ORS)", target: 5, conducted: 0, progress: 0 },
    { district: "Zaranj (Nimroz)", livelihood: "Greenhouse/kitchen gardening", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Processing of fruits and vegetables", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Livestock/animal husbandry", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Poultry", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Dairy products processing/production", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Tailoring", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Home kitchen cooking", target: 5, conducted: 6, progress: 120 },
    { district: "Zaranj (Nimroz)", livelihood: "Opening cafés and restaurants", target: 5, conducted: 5, progress: 100 },
    { district: "Zaranj (Nimroz)", livelihood: "Food shops", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Greenhouse/kitchen gardening", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Processing of fruits and vegetables", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Livestock/animal husbandry", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Poultry", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Dairy products processing/production", target: 5, conducted: 4, progress: 80 },
    { district: "Kamdesh (Nuristan)", livelihood: "Aquaculture/fishing", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Tailoring", target: 5, conducted: 5, progress: 100 },
    { district: "Kamdesh (Nuristan)", livelihood: "Plant nursery", target: 5, conducted: 6, progress: 120 },
    { district: "Kamdesh (Nuristan)", livelihood: "Soap making", target: 5, conducted: 3, progress: 60 },
  ],
};

const MOCK_PERFORMANCE_DATA: PerformanceData = {
  collection: [
    { id: 'KA01', needsReview: 12, validated: 2, total: 14, percentValidated: '14.3%', percentNeedsReview: '85.7%' },
    { id: 'KA02', needsReview: 8, validated: 3, total: 11, percentValidated: '27.3%', percentNeedsReview: '72.7%' },
    { id: 'KA03', needsReview: 7, validated: 1, total: 8, percentValidated: '12.5%', percentNeedsReview: '87.5%' },
    { id: 'KA04', needsReview: 8, validated: 1, total: 9, percentValidated: '11.1%', percentNeedsReview: '88.9%' },
    { id: 'KA05', needsReview: 0, validated: 1, total: 1, percentValidated: '100%', percentNeedsReview: '0%' },
    { id: 'SA01', needsReview: 3, validated: 1, total: 4, percentValidated: '25%', percentNeedsReview: '75%' },
    { id: 'SA02', needsReview: 3, validated: 1, total: 4, percentValidated: '25%', percentNeedsReview: '75%' },
    { id: 'SA03', needsReview: 8, validated: 3, total: 11, percentValidated: '27.3%', percentNeedsReview: '72.7%' },
    { id: 'SA04', needsReview: 1, validated: 0, total: 1, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'SA05', needsReview: 11, validated: 0, total: 11, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'SA06', needsReview: 17, validated: 0, total: 17, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'SA07', needsReview: 1, validated: 0, total: 1, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'SA08', needsReview: 1, validated: 0, total: 1, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'ZA01', needsReview: 11, validated: 0, total: 11, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'ZA02', needsReview: 5, validated: 0, total: 5, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'ZA03', needsReview: 5, validated: 0, total: 5, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'ZA04', needsReview: 10, validated: 0, total: 10, percentValidated: '0%', percentNeedsReview: '100%' },
    { id: 'ZA05', needsReview: 15, validated: 0, total: 15, percentValidated: '0%', percentNeedsReview: '100%' },
  ],
  quality: [
    { id: 'KA01', avgActiveTime: 23, avgTotalTime: 580, avgDkRate: '0.6%', avgIssuesPerSurvey: 0.00 },
    { id: 'KA02', avgActiveTime: 45, avgTotalTime: 879, avgDkRate: '1.1%', avgIssuesPerSurvey: 0.09 },
    { id: 'KA03', avgActiveTime: 123, avgTotalTime: 601, avgDkRate: '1%', avgIssuesPerSurvey: 0.00 },
    { id: 'KA04', avgActiveTime: 34, avgTotalTime: 470, avgDkRate: '2.4%', avgIssuesPerSurvey: 0.00 },
    { id: 'KA05', avgActiveTime: 49, avgTotalTime: 1123, avgDkRate: '1.2%', avgIssuesPerSurvey: 0.00 },
    { id: 'SA01', avgActiveTime: 40, avgTotalTime: 441, avgDkRate: '0.3%', avgIssuesPerSurvey: 0.00 },
    { id: 'SA02', avgActiveTime: 46, avgTotalTime: 284, avgDkRate: '0.6%', avgIssuesPerSurvey: 0.00 },
    { id: 'SA03', avgActiveTime: 27, avgTotalTime: 495, avgDkRate: '0.5%', avgIssuesPerSurvey: 0.00 },
    { id: 'SA04', avgActiveTime: 115, avgTotalTime: 336, avgDkRate: '0%', avgIssuesPerSurvey: 6.00 },
    { id: 'SA05', avgActiveTime: 69, avgTotalTime: 1231, avgDkRate: '0.7%', avgIssuesPerSurvey: 0.27 },
    { id: 'SA06', avgActiveTime: 41, avgTotalTime: 598, avgDkRate: '4.9%', avgIssuesPerSurvey: 0.00 },
    { id: 'SA07', avgActiveTime: 76, avgTotalTime: 317, avgDkRate: '0%', avgIssuesPerSurvey: 2.00 },
    { id: 'SA08', avgActiveTime: 67, avgTotalTime: 1506, avgDkRate: '2.3%', avgIssuesPerSurvey: 9.00 },
    { id: 'ZA01', avgActiveTime: 46, avgTotalTime: 190, avgDkRate: '1.6%', avgIssuesPerSurvey: 0.00 },
    { id: 'ZA02', avgActiveTime: 32, avgTotalTime: 4632, avgDkRate: '0.3%', avgIssuesPerSurvey: 0.00 },
    { id: 'ZA03', avgActiveTime: 48, avgTotalTime: 1786, avgDkRate: '4%', avgIssuesPerSurvey: 0.00 },
    { id: 'ZA04', avgActiveTime: 41, avgTotalTime: 1025, avgDkRate: '7.7%', avgIssuesPerSurvey: 0.00 },
    { id: 'ZA05', avgActiveTime: 38, avgTotalTime: 4687, avgDkRate: '7.3%', avgIssuesPerSurvey: 0.00 },
  ],
};

export const progressApi = {
  getProgressData: (): Promise<ProgressData> => {
    return new Promise(resolve => setTimeout(() => resolve(MOCK_PROGRESS_DATA), 300));
  },
  getPerformanceData: (): Promise<PerformanceData> => {
    return new Promise(resolve => setTimeout(() => resolve(MOCK_PERFORMANCE_DATA), 300));
  }
};