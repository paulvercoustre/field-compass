/**
 * What a submission's AI review status means, in plain words.
 * `llm_last_error` is stored as "<category>: <provider message>".
 */
export const describeAiCheck = (
  status: string | null | undefined,
  lastError: string | null | undefined,
  hasFindings: boolean
): { tone: 'busy' | 'ok' | 'warn' | 'muted'; title: string; detail?: string } => {
  const [category, ...rest] = (lastError ?? '').split(': ');
  const providerMessage = rest.join(': ').replace(/ \(retrying\)$/, '') || undefined;

  if (status === 'pending' || status === 'running') {
    return lastError
      ? { tone: 'busy', title: 'Reviewing… retrying after a temporary error.', detail: providerMessage }
      : { tone: 'busy', title: 'Reviewing the selected answers…' };
  }
  if (status === 'waiting') {
    return { tone: 'busy', title: 'Waiting for the transcript of a recorded answer…' };
  }
  if (status === 'cancelled') {
    // Stored as "cancelled: Stopped by Amina. It runs again on the next pull."
    return { tone: 'muted', title: providerMessage ?? 'Stopped before it ran. It runs again on the next pull.' };
  }
  if (status === 'success') {
    return hasFindings ? { tone: 'ok', title: 'Reviewed.' } : { tone: 'ok', title: 'Reviewed — nothing flagged.' };
  }
  if (status === 'not_run_allowance') {
    // Stored as "allowance: The included AI reviews for October, shared by ... are used up. ..."
    return {
      tone: 'warn',
      title: providerMessage ?? 'Not reviewed: this survey has used its included AI reviews for this month.',
    };
  }
  if (status === 'failed') {
    const reasons: Record<string, string> = {
      auth: "Couldn't review: the AI provider rejected the key.",
      provider_quota: "Couldn't review: the AI provider account is out of credit.",
      not_configured: "Couldn't review: no AI provider is set up.",
      bad_request: "Couldn't review: the AI provider refused the request.",
    };
    return {
      tone: 'warn',
      title: reasons[category] ?? "Couldn't review this time. It will be retried on the next pull.",
      detail: providerMessage ?? lastError ?? undefined,
    };
  }
  return { tone: 'muted', title: 'Not reviewed yet.' };
};
