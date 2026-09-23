import { useEffect, useState } from 'react';
import { DkValue, findDkValues } from '../services/lintApi';

/**
 * Which of a form's answer options mean "don't know".
 *
 * Found by the backend (`linter/dk.py`), not here, so the survey screens and
 * the form check never disagree: a form that codes don't-know as both `dk`
 * and `dont_know_answer` is reported by the check *and* has both pre-selected
 * here. Two matches are not an ambiguity -- both codings should be counted --
 * so every match is offered, and on the create screen every match is selected.
 *
 * What is selected is always the name. Kobo stores the name in submissions,
 * so the name is what the DK rate compares against; the label is only a way
 * of showing the user what they are choosing.
 */

const labelKeysOf = (choice: Record<string, any>): string[] =>
  Object.keys(choice).filter((key) => key === 'label' || key.startsWith('label::'));

/**
 * The label to show for a choice: English when present, otherwise the first
 * translation the form carries, otherwise nothing.
 */
export const choiceLabel = (choice: Record<string, any>): string => {
  const keys = labelKeysOf(choice);
  const english = keys.find((key) => /english/i.test(key));
  const chosen = english || keys[0];
  const value = chosen ? choice[chosen] : '';
  return typeof value === 'string' ? value : '';
};

/**
 * The form's don't-know codings, by name, or null while they are loading.
 *
 * An empty list on failure rather than a guess from a second set of rules:
 * the user can still add options by hand from the dropdown.
 */
export const useDkSuggestions = (choices: Array<Record<string, any>>): string[] | null => {
  const [values, setValues] = useState<string[] | null>(null);

  useEffect(() => {
    if (!choices || choices.length === 0) {
      // Callers pass a fresh `[]` each render when no form is loaded; keep the
      // same state object so that does not re-render in a loop.
      setValues((prev) => (prev && prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    setValues(null);
    findDkValues(choices)
      .then((found: DkValue[]) => {
        if (!cancelled) setValues(found.map((value) => value.name));
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [choices]);

  return values;
};

/**
 * Read `dk_string_value` in either shape.
 *
 * Stored configs hold a single string; new ones hold a list. Old configs are
 * never rewritten, so both shapes stay live and every reader has to cope --
 * mirroring `dk_string_tokens()` in backend/etl/dk_utils.py.
 */
export const readDkValues = (stored: string | string[] | null | undefined): string[] => {
  if (stored === null || stored === undefined) {
    return [];
  }
  const values = Array.isArray(stored) ? stored : [stored];
  const seen = new Set<string>();
  return values
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

/** Same values in the same order, ignoring case -- for dirty checks. */
export const sameDkValues = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, i) => value.toLowerCase() === b[i].toLowerCase());
