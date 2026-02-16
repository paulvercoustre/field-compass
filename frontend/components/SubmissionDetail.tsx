
import React, { useState, useEffect } from 'react';
import { Submission, QualityIssue } from '../types';
import JsonViewer from './JsonViewer';
import { Spinner } from './Spinner';
import { Badge, EditIcon, AlertIcon } from './Badge';
import { useSurvey } from '../contexts/SurveyContext';
import { getSurveyConfig, SurveyConfig, getValidationRules, ValidationRule } from '../services/progressApi';
import { getQuestionLabel, formatValueForDisplay } from '../utils/koboLabelUtils';
import { api } from '../services/api';
import ValidationStatusDropdown from './ValidationStatusDropdown';
import SuccessMessage from './ui/SuccessMessage';
import ErrorMessage from './ui/ErrorMessage';

interface SubmissionDetailProps {
  submission: Submission | null;
  isLoading: boolean;
}

// Helper to get value from submission data (path-based lookup like backend)
const getFieldValueFromData = (submissionData: Record<string, any>, fieldName: string): any => {
  if (!submissionData || !fieldName) return undefined;
  if (fieldName in submissionData) return submissionData[fieldName];
  for (const key in submissionData) {
    if (key.endsWith(`/${fieldName}`) || key === fieldName) return submissionData[key];
  }
  return undefined;
};

const getDurationMinutes = (config: SurveyConfig | null, data: Record<string, any>): number | null => {
  const v = data?.active_interview_time;
  if (v != null) try { return parseFloat(String(v)); } catch { return null; }
  const startF = config?.config_data?.core_identifiers?.start_time;
  const endF = config?.config_data?.core_identifiers?.end_time;
  if (!startF || !endF) return null;
  const s = getFieldValueFromData(data, startF);
  const e = getFieldValueFromData(data, endF);
  if (!s || !e) return null;
  try {
    return (new Date(e).getTime() - new Date(s).getTime()) / 60000;
  } catch {
    return null;
  }
};

// General check definitions - only checks enabled in survey settings are shown
const GENERAL_CHECK_DEFINITIONS: Array<{
  id: string;
  label: string;
  enabled: (config: SurveyConfig | null) => boolean;
  getDetails: (config: SurveyConfig | null, submissionData: Record<string, any>) => { field: string; value: any } | null;
}> = [
  { id: 'missing_uuid', label: 'Missing UUID', enabled: () => true, getDetails: (c, d) => { const f = c?.config_data?.core_identifiers?.uuid || '_uuid'; const v = getFieldValueFromData(d, f) ?? d?._uuid; return v != null ? { field: f, value: v } : null; } },
  { id: 'missing_enumerator', label: 'Missing Enumerator', enabled: () => true, getDetails: (c, d) => { const f = c?.config_data?.core_identifiers?.enumerator; if (!f) return null; return { field: f, value: getFieldValueFromData(d, f) }; } },
  { id: 'date_out_of_range', label: 'Date Out Of Range', enabled: (c) => !!(c?.config_data?.quality_checks?.flag_out_of_period && (c?.config_data?.global_parameters?.data_collection_start_date || c?.config_data?.global_parameters?.data_collection_end_date)), getDetails: (c, d) => { const f = c?.config_data?.core_identifiers?.date_interview; if (!f) return null; return { field: f, value: getFieldValueFromData(d, f) }; } },
  { id: 'interview_on_weekend', label: 'Interview On Weekend', enabled: (c) => !!(c?.config_data?.quality_checks?.flag_weekend), getDetails: (c, d) => { const f = c?.config_data?.core_identifiers?.date_interview; if (!f) return null; return { field: f, value: getFieldValueFromData(d, f) }; } },
  { id: 'interview_out_of_office_hours', label: 'Interview Out Of Office Hours', enabled: (c) => !!(c?.config_data?.quality_checks?.flag_office_hours), getDetails: (c, d) => { const f = c?.config_data?.core_identifiers?.start_time; if (!f) return null; return { field: f, value: getFieldValueFromData(d, f) }; } },
  { id: 'dk_percentage_high', label: 'DK Percentage High', enabled: (c) => !!(c?.config_data?.quality_checks?.flag_dk_percentage), getDetails: () => ({ field: 'submission', value: 'Within threshold' }) },
  { id: 'duration_too_short', label: 'Duration Too Short', enabled: (c) => c?.config_data?.global_parameters?.min_survey_duration_minutes != null, getDetails: (c, d) => { const v = getDurationMinutes(c, d); return v != null ? { field: 'active_interview_time', value: `${v.toFixed(2)} min` } : null; } },
  { id: 'duration_too_long', label: 'Duration Too Long', enabled: (c) => c?.config_data?.global_parameters?.max_survey_duration_minutes != null, getDetails: (c, d) => { const v = getDurationMinutes(c, d); return v != null ? { field: 'active_interview_time', value: `${v.toFixed(2)} min` } : null; } },
  { id: 'sampling_frame_mismatch', label: 'Sampling Frame Mismatch', enabled: (c) => !!(c?.config_data?.quality_checks?.flag_sampling_frame && c?.config_data?.sampling_frame?.sampling_cols?.length), getDetails: (c, d) => { const cols = c?.config_data?.sampling_frame?.sampling_cols; if (!cols?.length) return null; const combo = cols.map((col: string) => `${col}=${getFieldValueFromData(d, col) ?? 'N/A'}`).join(', '); return { field: cols.join(', '), value: combo }; } },
];

const SubmissionDetail: React.FC<SubmissionDetailProps> = ({ submission, isLoading }) => {
  const [surveyConfig, setSurveyConfig] = useState<SurveyConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [validationRules, setValidationRules] = useState<ValidationRule[]>([]);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());
  const [koboEditUrl, setKoboEditUrl] = useState<string | null>(null);
  const [isLoadingKoboUrl, setIsLoadingKoboUrl] = useState(false);
  const [isUpdatingValidation, setIsUpdatingValidation] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [reviewerNotesError, setReviewerNotesError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [isSavingReviewerNotes, setIsSavingReviewerNotes] = useState(false);
  const [showOutlierDetails, setShowOutlierDetails] = useState(false);
  const [showChecksList, setShowChecksList] = useState(false);
  const [showGeneralChecksList, setShowGeneralChecksList] = useState(false);
  const [expandedGeneralChecks, setExpandedGeneralChecks] = useState<Set<string>>(new Set());
  const { selectedSurvey } = useSurvey();

  const toggleGeneralCheckExpansion = (checkId: string) => {
    setExpandedGeneralChecks(prev => {
      const next = new Set(prev);
      if (next.has(checkId)) next.delete(checkId);
      else next.add(checkId);
      return next;
    });
  };

  // Clear success and error messages when submission changes
  useEffect(() => {
    setSuccess(null);
    setValidationError(null);
    setReviewerNotesError(null);
    setReviewerNotes(submission?.reviewer_notes || '');
    setShowChecksList(false);
    setShowGeneralChecksList(false);
  }, [submission?._id]);

  // Fetch survey config when submission or survey changes
  useEffect(() => {
    const fetchConfig = async () => {
      if (!selectedSurvey) return;
      
      setIsLoadingConfig(true);
      try {
        const config = await getSurveyConfig(selectedSurvey.survey_id);
        setSurveyConfig(config);
      } catch (error) {
        console.error('Failed to load survey config:', error);
      } finally {
        setIsLoadingConfig(false);
      }
    };

    fetchConfig();
  }, [selectedSurvey]);

  // Fetch validation rules when survey changes
  useEffect(() => {
    const fetchRules = async () => {
      if (!selectedSurvey) return;
      
      setIsLoadingRules(true);
      try {
        const rules = await getValidationRules(selectedSurvey.survey_id);
        setValidationRules(rules.filter(r => r.is_active));
      } catch (error) {
        console.error('Failed to load validation rules:', error);
      } finally {
        setIsLoadingRules(false);
      }
    };

    fetchRules();
  }, [selectedSurvey]);

  // Initialize expanded rules: expand all failed checks by default when submission or rules change
  useEffect(() => {
    if (!submission || validationRules.length === 0) return;

    const failedRuleIds = new Set<string>();
    validationRules.forEach((rule) => {
      const checkId = rule.rule_data.check_id || rule.rule_name;
      const issue = submission.data_quality_issues.find(issue => issue.check === checkId);
      if (issue) {
        // This is a failed check, expand it by default
        failedRuleIds.add(rule.rule_id);
      }
    });

    setExpandedRules(failedRuleIds);
  }, [submission, validationRules]);

  // Initialize expanded general checks: expand all failed checks by default
  useEffect(() => {
    if (!submission) return;
    const validationIds = new Set(validationRules.map(r => r.rule_data.check_id || r.rule_name));
    const isQual = (i: { check: string; metadata?: unknown }) =>
      i.check.startsWith('qual_') || (i.metadata as Record<string, unknown>)?.source === 'llm_qualitative_v1';
    const failedGeneralIds = new Set(
      submission.data_quality_issues
        .filter(i => !validationIds.has(i.check) && !i.check.startsWith('outlier_') && !isQual(i))
        .map(i => i.check)
    );
    setExpandedGeneralChecks(failedGeneralIds);
  }, [submission, validationRules]);

  // Fetch Kobo edit URL when submission or survey changes
  useEffect(() => {
    const fetchKoboEditUrl = async () => {
      if (!submission || !selectedSurvey) {
        setKoboEditUrl(null);
        return;
      }

      setIsLoadingKoboUrl(true);
      try {
        const url = await api.getKoboEditUrl(submission._id, selectedSurvey.survey_id);
        setKoboEditUrl(url);
      } catch (error) {
        console.error('Failed to fetch Kobo edit URL:', error);
        setKoboEditUrl(null);
      } finally {
        setIsLoadingKoboUrl(false);
      }
    };

    fetchKoboEditUrl();
  }, [submission, selectedSurvey]);

  if (!submission) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Select a submission from the queue to view details.</p>
      </div>
    );
  }

  const {
    _id,
    submission_data,
    has_edit_history,
    data_quality_issues,
    qa_status,
    kobo_validation_status,
    _submission_time,
    end,
    llm_check_status,
    llm_checked_at,
    llm_last_error,
  } = submission;

  // Check if a rule passed or failed for this submission
  const checkRuleStatus = (rule: ValidationRule): { passed: boolean; issue?: QualityIssue } => {
    const checkId = rule.rule_data.check_id || rule.rule_name;
    const issue = data_quality_issues.find(issue => issue.check === checkId);
    return {
      passed: !issue,
      issue,
    };
  };

  // Helper function to get value from submission data, handling Kobo path-based field names.
  // This matches the backend implementation in backend/etl/hfc_engine.py and backend/routers/progress.py
  // Kobo stores fields with full paths like 'module/variable' or 'module1/module2/variable',
  // but config may only specify 'variable'. This function searches for the field by:
  // 1. Direct lookup (exact match)
  // 2. Path-based search (field name at end of path, e.g., 'module/variable' matches 'variable')
  const getFieldValue = (fieldName: string): any => {
    if (!submission_data || !fieldName) return undefined;
    
    // First try direct lookup
    if (fieldName in submission_data) {
      return submission_data[fieldName];
    }
    
    // Search for fields that end with the field name (path-based)
    // e.g., 'enumerator_id' should match 'sampling_information/enumerator_id'
    // e.g., 'sampling_admin2' should match 'sampling_information/sampling_admin2'
    for (const key in submission_data) {
      if (key.endsWith(`/${fieldName}`) || key === fieldName) {
        return submission_data[key];
      }
    }
    
    // Not found
    return undefined;
  };

  // Extract metadata from submission data using survey config
  const getMetadata = () => {
    if (!surveyConfig || !submission_data) return null;

    const config = surveyConfig.config_data;
    const metadata: {
      enumerator?: string | null;
      enumeratorField?: string;
      sampling?: Record<string, any>;
      dateInterview?: string;
      duration?: number;
      activeDuration?: number;
    } = {};

    // Get enumerator - always try to get it if field is configured
    if (config.core_identifiers?.enumerator) {
      metadata.enumeratorField = config.core_identifiers.enumerator;
      const enumeratorValue = getFieldValue(config.core_identifiers.enumerator);
      // Include even if empty/null so we can show the field
      metadata.enumerator = enumeratorValue !== undefined ? String(enumeratorValue || 'N/A') : null;
    }

    // Get sampling information - always show configured columns
    if (config.sampling_frame?.sampling_cols && config.sampling_frame.sampling_cols.length > 0) {
      metadata.sampling = {};
      config.sampling_frame.sampling_cols.forEach((col: string) => {
        const value = getFieldValue(col);
        // Show all configured columns, even if empty
        // Use formatValueForDisplay to show labels for select_one/select_multiple fields
        if (value !== undefined && value !== null && value !== '') {
          metadata.sampling[col] = formatValueForDisplay(value, col, surveyConfig);
        } else {
          metadata.sampling[col] = 'N/A';
        }
      });
    }

    // Get interview date
    if (config.core_identifiers?.date_interview) {
      metadata.dateInterview = getFieldValue(config.core_identifiers.date_interview);
    }

    // Calculate duration if start and end times are available
    if (config.core_identifiers?.start_time && config.core_identifiers?.end_time) {
      const startTime = getFieldValue(config.core_identifiers.start_time);
      const endTime = getFieldValue(config.core_identifiers.end_time);
      
      if (startTime && endTime) {
        try {
          const start = new Date(startTime);
          const end = new Date(endTime);
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const diffMs = end.getTime() - start.getTime();
            metadata.duration = Math.round(diffMs / 1000 / 60); // Duration in minutes
          }
        } catch (e) {
          // Ignore date parsing errors
        }
      }
    }

    // Fallback: total_duration from audit logs if form fields didn't provide it
    if (metadata.duration === undefined) {
      const totalFromAudit = submission_data.total_duration;
      if (typeof totalFromAudit === 'number' && !isNaN(totalFromAudit)) {
        metadata.duration = Math.round(totalFromAudit);
      }
    }

    // Active duration from audit logs (time user was actively interacting)
    const activeTime = submission_data.active_interview_time;
    if (typeof activeTime === 'number' && !isNaN(activeTime)) {
      metadata.activeDuration = Math.round(activeTime);
    }

    return metadata;
  };

  const metadata = getMetadata();

  // Helper function to format field names (convert snake_case or path format to readable)
  const formatFieldName = (fieldName: string): string => {
    return fieldName
      .replace(/\//g, ' / ')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const isQualitativeIssue = (issue: QualityIssue): boolean => {
    const metadata = (issue.metadata || {}) as Record<string, any>;
    return issue.check.startsWith('qual_') || metadata.source === 'llm_qualitative_v1';
  };

  const qualitativeIssues = data_quality_issues.filter(isQualitativeIssue);

  // Toggle expansion state for a rule
  const toggleRuleExpansion = (ruleId: string) => {
    setExpandedRules(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ruleId)) {
        newSet.delete(ruleId);
      } else {
        newSet.add(ruleId);
      }
      return newSet;
    });
  };

  // Compute pass/fail counts for Custom Quality Checks
  const passedCount = validationRules.filter(rule => checkRuleStatus(rule).passed).length;
  const allPassed = validationRules.length > 0 && passedCount === validationRules.length;

  // General quality issues (excludes validation rules, outliers, qualitative)
  const validationRuleCheckIds = new Set(
    validationRules.map(rule => rule.rule_data.check_id || rule.rule_name)
  );
  const generalIssues = data_quality_issues.filter(
    issue => !validationRuleCheckIds.has(issue.check) && !issue.check.startsWith('outlier_') && !isQualitativeIssue(issue)
  );
  const allGeneralPassed = generalIssues.length === 0;

  // General checks enabled in survey settings (only these are shown)
  const enabledGeneralChecks = GENERAL_CHECK_DEFINITIONS.filter(d => d.enabled(surveyConfig));
  const generalPassedCount = enabledGeneralChecks.filter(c => !generalIssues.some(i => i.check === c.id)).length;

  // Handle validation status change
  const handleValidationStatusChange = async (newStatus: string | null) => {
    if (!selectedSurvey) return;
    
    setIsUpdatingValidation(true);
    setValidationError(null);
    setSuccess(null);
    
    try {
      const updatedSubmission = await api.updateValidationStatus(
        submission._id,
        selectedSurvey.survey_id,
        newStatus
      );
      
      // Update the submission prop (this would ideally trigger a re-fetch from parent)
      // For now, we'll update the local display
      Object.assign(submission, updatedSubmission);
      
      // Show success message
      const statusText = newStatus || 'cleared';
      setSuccess(`Validation status updated to: ${statusText}`);
    } catch (error) {
      console.error('Failed to update validation status:', error);
      setValidationError(error instanceof Error ? error.message : 'Failed to update validation status');
    } finally {
      setIsUpdatingValidation(false);
    }
  };

  // Handle reviewer notes save
  const handleSaveReviewerNotes = async () => {
    if (!selectedSurvey) return;

    setIsSavingReviewerNotes(true);
    setReviewerNotesError(null);
    setSuccess(null);

    try {
      const notesToSave = reviewerNotes.trim() === '' ? null : reviewerNotes;
      const updatedSubmission = await api.updateReviewerNotes(
        submission._id,
        selectedSurvey.survey_id,
        notesToSave
      );

      // Update local display
      Object.assign(submission, updatedSubmission);
      setReviewerNotes(updatedSubmission.reviewer_notes || '');
      setSuccess('Reviewer notes saved');
    } catch (error) {
      console.error('Failed to save reviewer notes:', error);
      setReviewerNotesError(error instanceof Error ? error.message : 'Failed to save reviewer notes');
    } finally {
      setIsSavingReviewerNotes(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 min-w-0">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Submission <span className="font-mono">#{_id}</span></h2>
        
        {/* Inline metadata badges */}
        <div className="flex items-center gap-3 mt-2 text-sm text-gray-600 dark:text-gray-400">
          {has_edit_history && (
            <span className="flex items-center gap-1">
              <EditIcon />
              Edited
            </span>
          )}
          {data_quality_issues.length > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertIcon />
              {data_quality_issues.length} issue{data_quality_issues.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        
        {/* Action row */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Actions:
          </span>
          
          {/* Edit in Kobo button - compact */}
          {isLoadingKoboUrl ? (
            <div className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Loading...</span>
            </div>
          ) : koboEditUrl ? (
            <a
              href={koboEditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Edit in Kobo
            </a>
          ) : null}
          
          {/* Validation dropdown */}
          <ValidationStatusDropdown 
            currentStatus={kobo_validation_status}
            onChange={handleValidationStatusChange}
            isUpdating={isUpdatingValidation}
            disabled={isUpdatingValidation}
          />
        </div>

        {/* Success/Error messages */}
        {success && (
          <SuccessMessage message={success} onDismiss={() => setSuccess(null)} className="mt-3" />
        )}
        {validationError && (
          <ErrorMessage message={validationError} onDismiss={() => setValidationError(null)} className="mt-3" />
        )}

        {/* Quality issues warning */}
        {data_quality_issues.length > 0 && (
          kobo_validation_status === 'Approved' ? (
            <div className="mt-2 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded flex items-center gap-1.5">
              <AlertIcon className="w-3.5 h-3.5" />
              This submission has {data_quality_issues.length} quality issue{data_quality_issues.length > 1 ? 's' : ''} but is marked as approved
            </div>
          ) : !kobo_validation_status && (
            <div className="mt-2 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded flex items-center gap-1.5">
              <AlertIcon className="w-3.5 h-3.5" />
              Review {data_quality_issues.length} quality issue{data_quality_issues.length > 1 ? 's' : ''} below before validation
            </div>
          )
        )}
      </div>

      <div className="flex-1 p-4 overflow-y-auto min-w-0">
        {/* Metadata Panel */}
        {metadata && (
          <div className="mb-6">
            <h3 className="mb-3 text-lg font-semibold text-gray-800 dark:text-gray-200">Submission Overview</h3>
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Enumerator - Always show if field is configured */}
              {metadata.enumeratorField && (
                <div className="md:col-span-1">
                  <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Enumerator</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className={`text-sm font-semibold ${metadata.enumerator && metadata.enumerator !== 'N/A' ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>
                      {metadata.enumerator || 'Not available'}
                    </span>
                  </div>
                </div>
              )}

              {/* Interview Date - Show this instead of submission date */}
              {metadata.dateInterview ? (
                <div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Interview Date</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{String(metadata.dateInterview)}</span>
                  </div>
                </div>
              ) : _submission_time ? (
                <div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Submitted</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {new Date(_submission_time).toLocaleString()}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Duration */}
              {metadata.duration !== undefined && (
                <div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Duration</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{metadata.duration} min</span>
                  </div>
                </div>
              )}

              {/* Active Duration */}
              {metadata.activeDuration !== undefined && (
                <div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Active Duration</span>
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{metadata.activeDuration} min</span>
                  </div>
                </div>
              )}

              {/* Sampling Information - Always show if configured */}
              {metadata.sampling && Object.keys(metadata.sampling).length > 0 && (
                <div className="md:col-span-2 lg:col-span-4">
                  <span className="text-xs text-gray-600 dark:text-gray-400 block mb-2">Sampling Information</span>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(metadata.sampling).map(([key, value]) => (
                      <div key={key} className="flex items-center">
                        <span className="text-xs text-gray-600 dark:text-gray-400 mr-2">{formatFieldName(key)}:</span>
                        <span className={`text-sm font-medium ${
                          value !== 'N/A' && value !== null && value !== '' 
                            ? 'text-gray-900 dark:text-white' 
                            : 'text-gray-500'
                        }`}>
                          {String(value !== null && value !== '' ? value : 'Not available')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviewer Notes */}
              <div className="md:col-span-2 lg:col-span-4">
                <span className="text-xs text-gray-600 dark:text-gray-400 block mb-2">Reviewer Notes</span>
                <div className="space-y-2">
                  <textarea
                    value={reviewerNotes}
                    onChange={(e) => setReviewerNotes(e.target.value)}
                    placeholder="Add reviewer notes for this submission..."
                    rows={3}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 p-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    disabled={isSavingReviewerNotes}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Notes are saved to this submission and visible to reviewers with access.
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveReviewerNotes}
                      disabled={isSavingReviewerNotes}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSavingReviewerNotes ? 'Saving...' : 'Save notes'}
                    </button>
                  </div>
                  {reviewerNotesError && (
                    <ErrorMessage message={reviewerNotesError} onDismiss={() => setReviewerNotesError(null)} />
                  )}
                </div>
              </div>
              </div>
            </div>
          </div>
        )}

        {/* General Quality Checks Section - Collapsed when all passed, full list when any failed */}
        <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">General Quality Checks</h3>
                {enabledGeneralChecks.length > 0 && (
                    <span className={`text-sm font-medium ${
                        allGeneralPassed
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-orange-700 dark:text-orange-400'
                    }`}>
                        {`${generalPassedCount}/${enabledGeneralChecks.length} tests passed`}
                    </span>
                )}
                {enabledGeneralChecks.length > 0 && allGeneralPassed && (
                    <button
                        type="button"
                        onClick={() => setShowGeneralChecksList(prev => !prev)}
                        className="inline-flex items-center p-1 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        aria-label={showGeneralChecksList ? 'Hide checks list' : 'Show checks list'}
                    >
                        <svg
                            className={`w-4 h-4 transition-transform ${showGeneralChecksList ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                )}
            </div>
            {(allGeneralPassed && !showGeneralChecksList) ? null : (
                <div className="space-y-3">
                    {enabledGeneralChecks.length === 0 ? (
                        <p className="text-sm text-gray-600 dark:text-gray-400">No general checks configured for this survey.</p>
                    ) : (
                        enabledGeneralChecks.map((check) => {
                            const issue = generalIssues.find(i => i.check === check.id);
                            const passed = !issue;
                            const isExpanded = expandedGeneralChecks.has(check.id);
                            const details = passed
                                ? check.getDetails(surveyConfig, submission_data || {})
                                : null;
                            const shouldShowDetails = isExpanded && (passed ? details : !!issue);
                            return (
                                <div
                                    key={check.id}
                                    className={`p-4 rounded-md border ${
                                        passed
                                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/50'
                                            : 'bg-orange-50 dark:bg-orange-900/50 border-orange-200 dark:border-orange-700/50'
                                    }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleGeneralCheckExpansion(check.id)}
                                                    className={`flex-shrink-0 p-1 rounded transition-colors ${
                                                        passed
                                                            ? 'hover:bg-green-100 dark:hover:bg-green-900/40'
                                                            : 'hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                    }`}
                                                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                                >
                                                    <svg
                                                        className={`w-4 h-4 transition-transform ${
                                                            isExpanded ? 'rotate-180' : ''
                                                        } ${passed ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400'}`}
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>
                                                <h4 className={`font-semibold text-sm ${
                                                    passed ? 'text-green-800 dark:text-green-300' : 'text-orange-800 dark:text-orange-300'
                                                }`}>
                                                    {check.label}
                                                </h4>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                            {passed ? (
                                                <>
                                                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    <span className="text-sm font-medium text-green-700 dark:text-green-400">Passed</span>
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                    <span className="text-sm font-medium text-red-700 dark:text-red-400">Flagged</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {shouldShowDetails && (
                                        <div className="mt-3 space-y-2">
                                            {!passed && issue && (
                                                <p className="text-sm text-orange-700 dark:text-orange-400">{issue.message}</p>
                                            )}
                                            {!passed && issue ? (
                                                <>
                                                    {issue.field && (
                                                        <div className="text-sm">
                                                            <span className="font-medium text-gray-700 dark:text-gray-300">Field: </span>
                                                            <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{issue.field}</span>
                                                        </div>
                                                    )}
                                                    {issue.value !== null && issue.value !== undefined && (
                                                        <div className="text-sm">
                                                            <span className="font-medium text-gray-700 dark:text-gray-300">Value: </span>
                                                            <span className="text-gray-600 dark:text-gray-400">{String(issue.value)}</span>
                                                        </div>
                                                    )}
                                                </>
                                            ) : details ? (
                                                <>
                                                    <div className="text-sm">
                                                        <span className="font-medium text-gray-700 dark:text-gray-300">Field: </span>
                                                        <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{details.field}</span>
                                                    </div>
                                                    <div className="text-sm">
                                                        <span className="font-medium text-gray-700 dark:text-gray-300">Value: </span>
                                                        <span className="text-gray-600 dark:text-gray-400">
                                                            {typeof details.value === 'object' ? JSON.stringify(details.value) : String(details.value)}
                                                        </span>
                                                    </div>
                                                </>
                                            ) : null}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>


        {/* Quality Checks Section - Collapsed when all passed, full list when any failed */}
        {validationRules.length > 0 && (
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Custom Quality Checks</h3>
                    {!isLoadingRules && (
                        <span className={`text-sm font-medium ${
                            allPassed
                                ? 'text-green-700 dark:text-green-400'
                                : 'text-orange-700 dark:text-orange-400'
                        }`}>
                            {passedCount}/{validationRules.length} tests passed
                        </span>
                    )}
                    {!isLoadingRules && allPassed && (
                        <button
                            type="button"
                            onClick={() => setShowChecksList(prev => !prev)}
                            className="inline-flex items-center p-1 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            aria-label={showChecksList ? 'Hide checks list' : 'Show checks list'}
                        >
                            <svg
                                className={`w-4 h-4 transition-transform ${showChecksList ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    )}
                </div>
                {isLoadingRules ? (
                    <div className="flex justify-center py-4">
                        <Spinner />
                    </div>
                ) : (allPassed && !showChecksList) ? (
                    null
                ) : (
                    <div className="space-y-3">
                        {validationRules.map((rule) => {
                            const { passed, issue } = checkRuleStatus(rule);
                            const ruleName = rule.rule_data.check_id || rule.rule_name;
                            const variables = rule.rule_data.variables_involved || [];
                            const isExpanded = expandedRules.has(rule.rule_id);
                            // Both passed and failed checks respect the expanded state
                            const shouldShowDetails = isExpanded;
                            
                            return (
                                <div
                                    key={rule.rule_id}
                                    className={`p-4 rounded-md border ${
                                        passed
                                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/50'
                                            : 'bg-orange-50 dark:bg-orange-900/50 border-orange-200 dark:border-orange-700/50'
                                    }`}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => toggleRuleExpansion(rule.rule_id)}
                                                    className={`flex-shrink-0 p-1 rounded transition-colors ${
                                                        passed
                                                            ? 'hover:bg-green-100 dark:hover:bg-green-900/40'
                                                            : 'hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                                    }`}
                                                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                                >
                                                    <svg
                                                        className={`w-4 h-4 transition-transform ${
                                                            isExpanded ? 'rotate-180' : ''
                                                        } ${passed ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400'}`}
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>
                                                <h4 className={`font-semibold text-sm ${
                                                    passed
                                                        ? 'text-green-800 dark:text-green-300'
                                                        : 'text-orange-800 dark:text-orange-300'
                                                }`}>
                                                    {rule.rule_name || ruleName}
                                                </h4>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                            {passed ? (
                                                <>
                                                    <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    <span className="text-sm font-medium text-green-700 dark:text-green-400">Passed</span>
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                    <span className="text-sm font-medium text-red-700 dark:text-red-400">Flagged</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Show issue message if failed */}
                                    {!passed && issue && (
                                        <p className="text-sm mt-3 text-orange-700 dark:text-orange-400">
                                            {issue.message || rule.rule_data.issue}
                                        </p>
                                    )}
                                    
                                    {/* Show variables when expanded, or fallback when no variables */}
                                    {shouldShowDetails && (
                                        variables.length > 0 ? (
                                            <div className="mt-3 space-y-2">
                                                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Variables:</p>
                                                {variables.map((variable) => {
                                                    const value = getFieldValue(variable);
                                                    const questionLabel = getQuestionLabel(variable, surveyConfig);
                                                    const displayValue = formatValueForDisplay(value, variable, surveyConfig);
                                                    return (
                                                        <div key={variable} className="pl-3 border-l-2 border-gray-300 dark:border-gray-600">
                                                            <div className="text-sm">
                                                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                                                    {questionLabel}
                                                                </span>
                                                                <span className="text-gray-500 dark:text-gray-400 ml-2 font-mono text-xs">
                                                                    ({variable})
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                                <span className="font-medium">Value: </span>
                                                                <span>{displayValue}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className="text-sm mt-3 text-gray-600 dark:text-gray-400">No additional details.</p>
                                        )
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        )}

        {/* Qualitative Quality Checks Section - AI-powered qualitative response analysis */}
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-800 dark:text-gray-200">Qualitative Quality Checks</h3>
          <div className="p-4 rounded-md border bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              {(llm_check_status === 'pending' || llm_check_status === 'running') ? (
                <>
                  <svg className="w-4 h-4 animate-spin text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">AI qualitative check in progress</span>
                </>
              ) : (
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Status: {llm_check_status || 'skipped'}
                </span>
              )}
              {llm_checked_at && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Last checked: {new Date(llm_checked_at).toLocaleString()}
                </span>
              )}
            </div>

            {llm_last_error && (
              <div className="mb-3 text-sm text-red-700 dark:text-red-400">
                Error: {llm_last_error}
              </div>
            )}

            {qualitativeIssues.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {llm_check_status === 'success'
                  ? 'No qualitative issues detected in the latest AI check.'
                  : 'No qualitative findings available yet.'}
              </p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const groupedByField = qualitativeIssues.reduce<Record<string, typeof qualitativeIssues>>(
                    (acc, issue) => {
                      const key = issue.field ?? 'unknown';
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(issue);
                      return acc;
                    },
                    {}
                  );
                  return Object.entries(groupedByField).map(([field, issues]) => {
                    const first = issues[0];
                    const question = field !== 'unknown' ? getQuestionLabel(field, surveyConfig) : null;
                    const answer = first.value !== null && first.value !== undefined ? String(first.value) : 'N/A';
                    return (
                      <div
                        key={field}
                        className="p-3 rounded-md border bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700/40"
                      >
                        <div className="space-y-2 text-sm">
                          <p className="text-gray-800 dark:text-gray-200">
                            <span className="font-semibold">Question:</span>{' '}
                            <span>{question || field || 'Unknown'}</span>
                          </p>
                          <p className="text-gray-800 dark:text-gray-200">
                            <span className="font-semibold">Answer:</span>{' '}
                            <span>{answer}</span>
                          </p>
                          <div className="space-y-2 mt-3">
                            {issues.map((issue) => {
                              const issueType = issue.check.replace(/^qual_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                              const aiAnalysis = (issue.metadata as Record<string, any> | undefined)?.llm_reasoning || issue.message;
                              return (
                                <div key={issue.check} className="pl-3 border-l-2 border-purple-300 dark:border-purple-600/50">
                                  <p className="text-gray-800 dark:text-gray-200">
                                    <span className="font-semibold">{issueType}:</span>{' '}
                                    <span className="text-purple-900 dark:text-purple-100">{aiAnalysis}</span>
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Outlier Checks Section - Shows outlier-specific issues */}
        {data_quality_issues.length > 0 && (() => {
            // Filter for outlier issues only
            const outlierIssues = data_quality_issues.filter(
                issue => issue.check.startsWith('outlier_')
            );

            if (outlierIssues.length === 0) return null;

            const firstOutlierMetadata = outlierIssues[0]?.metadata;

            return (
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Outlier Checks</h3>
                        <button
                            type="button"
                            onClick={() => setShowOutlierDetails(!showOutlierDetails)}
                            className="inline-flex items-center p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                            title="Outlier detection details"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    </div>
                    {showOutlierDetails && firstOutlierMetadata && (
                        <div className="mb-3 p-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-md text-xs text-gray-700 dark:text-gray-300">
                            <p>
                                <strong>Method:</strong> {firstOutlierMetadata.method?.toUpperCase() || '—'}
                                <span className="ml-3"><strong>Threshold:</strong> {firstOutlierMetadata.threshold ?? '—'}</span>
                            </p>
                            <p className="mt-1 text-gray-600 dark:text-gray-400">
                                {firstOutlierMetadata.method === 'iqr'
                                    ? 'IQR (Interquartile Range): uses quartiles and IQR to define expected range'
                                    : firstOutlierMetadata.method === 'mad'
                                    ? 'MAD (Median Absolute Deviation): robust method using median and MAD'
                                    : firstOutlierMetadata.method === 'zscore'
                                    ? 'Z-Score: uses mean and standard deviation'
                                    : ''}
                            </p>
                        </div>
                    )}
                    <div className="space-y-3">
                        {outlierIssues.map((issue, index) => {
                            const variableName = issue.check.replace('outlier_', '');
                            const fieldValue = getFieldValue(variableName);
                            const questionLabel = surveyConfig ? getQuestionLabel(variableName, surveyConfig) : null;
                            const displayValue = fieldValue !== undefined && fieldValue !== null && surveyConfig ? formatValueForDisplay(fieldValue, variableName, surveyConfig) : null;

                            // Extract outlier metadata if available
                            const outlierMetadata = issue.metadata;

                            return (
                                <div
                                    key={`${issue.check}-${index}`}
                                    className="p-4 rounded-md border bg-orange-50 dark:bg-orange-900/50 border-orange-200 dark:border-orange-700/50"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <svg className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                </svg>
                                                <h4 className="font-semibold text-sm text-orange-800 dark:text-orange-300">
                                                    {`Outlier: ${questionLabel || variableName || issue.field}`}
                                                </h4>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                            <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                            </svg>
                                            <span className="text-sm font-medium text-orange-700 dark:text-orange-400">Outlier Detected</span>
                                        </div>
                                    </div>

                                    {/* Statistical context for outliers */}
                                    <div className="mt-3 space-y-2">
                                        <div className="pl-3 border-l-2 border-orange-300 dark:border-orange-600 space-y-2">
                                            {questionLabel && (
                                                <div className="text-sm">
                                                    <span className="font-medium text-gray-700 dark:text-gray-300">
                                                        {questionLabel}
                                                    </span>
                                                    <span className="text-gray-500 dark:text-gray-400 ml-2 font-mono text-xs">
                                                        ({variableName})
                                                    </span>
                                                </div>
                                            )}
                                            {fieldValue !== undefined && fieldValue !== null && (
                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                    <span className="font-medium">Value: </span>
                                                    <span>{displayValue !== null ? displayValue : String(fieldValue)}</span>
                                                </div>
                                            )}

                                            {/* Statistical bounds */}
                                            {outlierMetadata && outlierMetadata.bounds ? (
                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                    <span className="font-medium">Expected range: </span>
                                                    <span className="font-mono">
                                                        {outlierMetadata.bounds.lower_bound !== undefined && outlierMetadata.bounds.upper_bound !== undefined
                                                            ? `${Math.round(outlierMetadata.bounds.lower_bound)} to ${Math.round(outlierMetadata.bounds.upper_bound)}`
                                                            : outlierMetadata.bounds.note || 'Unable to calculate'
                                                        }
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="text-sm text-red-600 dark:text-red-400">
                                                    No bounds data available
                                                </div>
                                            )}

                                            {/* Overflow bar - shows how far value is outside expected range */}
                                            {outlierMetadata?.bounds?.lower_bound !== undefined &&
                                             outlierMetadata?.bounds?.upper_bound !== undefined &&
                                             !outlierMetadata?.bounds?.note && (() => {
                                                const lb = outlierMetadata.bounds!.lower_bound!;
                                                const ub = outlierMetadata.bounds!.upper_bound!;
                                                const numValue = typeof issue.value === 'number'
                                                    ? issue.value
                                                    : parseFloat(String(fieldValue));
                                                const rangeWidth = ub - lb;
                                                if (rangeWidth <= 0 || isNaN(numValue)) return null;
                                                const isAbove = numValue > ub;
                                                const distance = isAbove ? numValue - ub : lb - numValue;
                                                const rawRatio = distance / rangeWidth;
                                                const overflowRatio = Math.min(rawRatio, 4); // cap at 4x (was 2x) for extreme outliers
                                                const overflowPx = Math.round(60 * overflowRatio);
                                                const rangePx = 60;
                                                const isExtreme = rawRatio > 3; // red tint for very extreme outliers
                                                const barMaxWidth = rangePx + overflowPx;
                                                return (
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="flex h-2.5 overflow-hidden rounded"
                                                            style={{ width: Math.min(barMaxWidth, 280) }}
                                                            title={`${Math.round(distance)} ${isAbove ? 'above' : 'below'} expected range (${rawRatio.toFixed(1)}×)`}
                                                        >
                                                            {isAbove ? (
                                                                <>
                                                                    <div className="h-full flex-shrink-0 bg-gray-300 dark:bg-gray-600" style={{ width: rangePx }} />
                                                                    <div
                                                                        className={`h-full flex-shrink-0 ${isExtreme ? 'bg-red-500 dark:bg-red-600' : 'bg-orange-400 dark:bg-orange-500'}`}
                                                                        style={{ width: overflowPx }}
                                                                    />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div
                                                                        className={`h-full flex-shrink-0 ${isExtreme ? 'bg-red-500 dark:bg-red-600' : 'bg-orange-400 dark:bg-orange-500'}`}
                                                                        style={{ width: overflowPx }}
                                                                    />
                                                                    <div className="h-full flex-shrink-0 bg-gray-300 dark:bg-gray-600" style={{ width: rangePx }} />
                                                                </>
                                                            )}
                                                        </div>
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                                            {isAbove ? `${Math.round(distance)} above` : `${Math.round(distance)} below`}
                                                            {rawRatio > 4 && (
                                                                <span className="ml-0.5 text-amber-600 dark:text-amber-400" title={`Actual: ${rawRatio.toFixed(1)}× expected range`}>
                                                                    (4×+)
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                );
                                            })()}

                                            {/* Statistics */}
                                            {outlierMetadata && outlierMetadata.statistics ? (
                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                    <span className="font-medium">Dataset stats: </span>
                                                    <span className="font-mono">
                                                        mean={Math.round(outlierMetadata.statistics.mean)},
                                                        median={Math.round(outlierMetadata.statistics.median)},
                                                        n={outlierMetadata.statistics.count}
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="text-sm text-red-600 dark:text-red-400">
                                                    No statistics data available
                                                </div>
                                            )}

                                            {/* Sample size warning */}
                                            {outlierMetadata && outlierMetadata.sample_size_warning && (
                                                <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
                                                    <span className="font-medium">⚠️ {outlierMetadata.sample_size_warning}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        })()}

        <div className="min-w-0">
            <div className="py-4 min-w-0">
                {isLoading ? (
                    <div className="flex justify-center mt-8">
                        <Spinner />
                    </div>
                ) : (
                    <JsonViewer data={submission_data} />
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default SubmissionDetail;