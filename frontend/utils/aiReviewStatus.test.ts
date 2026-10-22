import { describe, expect, it } from 'vitest';
import { describeAiCheck } from './aiReviewStatus';

describe('describeAiCheck', () => {
  it('says a review waits for the owner to confirm their address, and nothing more', () => {
    const status = describeAiCheck(
      'failed',
      'unconfirmed: AI features start once the survey owner confirms their email address.',
      false
    );
    expect(status).toEqual({
      tone: 'warn',
      title: "Not reviewed: the survey owner hasn't confirmed their email address yet.",
    });
  });

  it("names the provider's refusal", () => {
    expect(describeAiCheck('failed', 'auth: invalid key', false).title).toBe(
      "Couldn't review: the AI provider rejected the key."
    );
  });
});
