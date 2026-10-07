import { useCallback, useState } from 'react';
import { createValidationRule, deleteValidationRule, getValidationRules, updateValidationRule } from '../services/progressApi';
import { StagedRule } from '../types';
import { dbFormatToStagedRule, stagedRuleToDbFormat } from '../utils/ruleConverter';

const create = (surveyId: string, rule: Omit<StagedRule, 'id'>) =>
  createValidationRule(surveyId, {
    rule_name: rule.description,
    rule_data: stagedRuleToDbFormat({ ...rule, id: '' }),
    is_active: true,
  });

/**
 * A survey's custom checks, as saved on the server. Every change is sent
 * straight away and the list read back, so what is shown is what will run.
 *
 * `save` and `addMany` rethrow after reporting, so a form can stay open with
 * what the user entered.
 */
export function useCustomChecks(surveyId: string | undefined, onError: (message: string) => void) {
  const [rules, setRules] = useState<StagedRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!surveyId) return;
    setIsLoading(true);
    try {
      const saved = await getValidationRules(surveyId);
      setRules(saved.map((rule) => dbFormatToStagedRule(rule.rule_id, rule.rule_name, rule.rule_data)));
    } catch (err) {
      // The rest of the page still works; the list just stays as it was.
      console.error('Error loading validation rules:', err);
    } finally {
      setIsLoading(false);
    }
  }, [surveyId]);

  const save = useCallback(
    async (rule: Omit<StagedRule, 'id'>, ruleId: string | null) => {
      if (!surveyId) return;
      try {
        if (ruleId) {
          await updateValidationRule(surveyId, ruleId, {
            rule_name: rule.description,
            rule_data: stagedRuleToDbFormat({ ...rule, id: '' }),
          });
        } else {
          await create(surveyId, rule);
        }
        await reload();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to save the check');
        throw err;
      }
    },
    [surveyId, reload, onError]
  );

  const remove = useCallback(
    async (ruleId: string) => {
      if (!surveyId) return;
      try {
        await deleteValidationRule(surveyId, ruleId);
        setRules((current) => current.filter((r) => r.id !== ruleId));
        await reload();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to delete the check');
      }
    },
    [surveyId, reload, onError]
  );

  const addMany = useCallback(
    async (suggested: StagedRule[]) => {
      if (!surveyId) return;
      try {
        for (const rule of suggested) {
          await create(surveyId, rule);
        }
        await reload();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to add the suggested checks');
        throw err;
      }
    },
    [surveyId, reload, onError]
  );

  return { rules, isLoading, reload, save, remove, addMany };
}
