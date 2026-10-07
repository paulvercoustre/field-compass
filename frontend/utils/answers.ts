/**
 * An answer from a Kobo submission, by question name.
 *
 * Kobo keys each answer by its group path ('household/age') while settings
 * name the question alone ('age'): an exact key wins, otherwise the first key
 * ending in '/<name>'. Mirrors backend/forms/answers.py, so the screen reads
 * the same answer the checks did. Undefined when absent.
 */
export const findAnswer = (data: Record<string, any> | null | undefined, name: string | null | undefined): any => {
  if (!data || !name) return undefined;
  if (name in data) return data[name];
  const suffix = `/${name}`;
  for (const key of Object.keys(data)) {
    if (key.endsWith(suffix)) return data[key];
  }
  return undefined;
};
