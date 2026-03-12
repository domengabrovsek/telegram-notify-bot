import { buildSecurityAlert, isAuthorized } from '@/auth/authorizer';

describe('isAuthorized', () => {
  const authorizedIds = ['111', '222', '333'];

  it('returns true for authorized chat ID', () => {
    expect(isAuthorized('222', authorizedIds)).toBe(true);
  });

  it('returns false for unauthorized chat ID', () => {
    expect(isAuthorized('999', authorizedIds)).toBe(false);
  });

  it('returns false for empty authorized list', () => {
    expect(isAuthorized('111', [])).toBe(false);
  });
});

describe('buildSecurityAlert', () => {
  it('builds webhook alert with user info', () => {
    const alert = buildSecurityAlert('webhook', '999', 'bad message', {
      id: 1,
      is_bot: false,
      first_name: 'Bad',
      last_name: 'Actor',
      username: 'badactor',
      language_code: 'en',
    });

    expect(alert).toContain('Unauthorized bot access attempt');
    expect(alert).toContain('Chat ID: 999');
    expect(alert).toContain('User: Bad Actor (@badactor)');
    expect(alert).toContain('Message: "bad message"');
    expect(alert).toContain('Time:');
  });

  it('builds webhook alert with missing user info', () => {
    const alert = buildSecurityAlert('webhook', '999', 'sneaky');

    expect(alert).toContain('User: Unknown  (@no-username)');
  });

  it('builds API alert without user info', () => {
    const alert = buildSecurityAlert('api', '999', 'unauthorized call');

    expect(alert).toContain('Unauthorized API call attempt');
    expect(alert).toContain('Chat ID: 999');
    expect(alert).toContain('Message: "unauthorized call"');
    expect(alert).not.toContain('User:');
  });
});
