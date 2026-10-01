import { createHmac } from 'node:crypto';
import { handleGitHubWebhook } from '@/services/github-webhook';

vi.mock('@/services/config', () => ({
  getParameter: vi.fn(),
  getTelegramConfig: vi.fn(),
}));

vi.mock('@/services/telegram-client', () => ({
  sendMessage: vi.fn(),
}));

import { getParameter, getTelegramConfig } from '@/services/config';
import { sendMessage } from '@/services/telegram-client';

const mockGetParameter = vi.mocked(getParameter);
const mockGetTelegramConfig = vi.mocked(getTelegramConfig);
const mockSendMessage = vi.mocked(sendMessage);

const secret = 'webhook-secret';

const mergedPayload = {
  action: 'closed',
  repository: { html_url: 'https://github.com/domengabrovsek/home-infra', default_branch: 'main' },
  pull_request: {
    title: 'feat: add webhook',
    html_url: 'https://github.com/domengabrovsek/home-infra/pull/42',
    user: { login: 'domengabrovsek', type: 'User' },
    head: { ref: 'feat/webhook' },
    base: { ref: 'main' },
    merged: true,
  },
};

function delivery(event: string, payload: unknown, signature?: string) {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const headers: Record<string, string | undefined> = {
    'x-github-event': event,
    'x-github-delivery': 'delivery-1',
    'x-hub-signature-256': signature ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
  };
  return { headers, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetParameter.mockResolvedValue(secret);
  mockGetTelegramConfig.mockResolvedValue({ botToken: 'bot-token', adminChatId: '111', additionalChatIds: ['222'] });
  mockSendMessage.mockResolvedValue();
});

describe('handleGitHubWebhook', () => {
  it('reads the secret from the github-webhook-secret parameter', async () => {
    const { headers, body } = delivery('ping', { zen: 'hi' });

    await handleGitHubWebhook(headers, body);

    expect(mockGetParameter).toHaveBeenCalledWith('/telegram-notify-bot/github-webhook-secret', expect.any(String));
  });

  it('sends a valid signed event to the admin chat and returns 200', async () => {
    const { headers, body } = delivery('pull_request', mergedPayload);

    const result = await handleGitHubWebhook(headers, body);

    expect(result).toEqual({ statusCode: 200, body: JSON.stringify({ ok: true }) });
    expect(mockSendMessage).toHaveBeenCalledWith(expect.stringContaining('✅ Pull Request Merged'), '111', 'bot-token');
  });

  it('returns 401 and sends nothing for an invalid signature', async () => {
    const { headers, body } = delivery('pull_request', mergedPayload, `sha256=${'0'.repeat(64)}`);

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 401 and sends nothing for a missing signature', async () => {
    const { headers, body } = delivery('pull_request', mergedPayload);
    delete headers['x-hub-signature-256'];

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(401);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 401 for a ping with a bad signature', async () => {
    const { headers, body } = delivery('ping', { zen: 'hi' }, 'sha256=bad');

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(401);
  });

  it('returns 200 for ping and sends nothing', async () => {
    const { headers, body } = delivery('ping', { zen: 'hi' });

    const result = await handleGitHubWebhook(headers, body);

    expect(result).toEqual({ statusCode: 200, body: JSON.stringify({ ok: true }) });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 200 and sends nothing for an unhandled event', async () => {
    const { headers, body } = delivery('push', { ref: 'refs/heads/main' });

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(200);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 200 and sends nothing for a bot-authored comment', async () => {
    const { headers, body } = delivery('issue_comment', {
      action: 'created',
      repository: mergedPayload.repository,
      issue: { title: 'feat: add webhook', pull_request: {} },
      comment: { body: 'plan output', html_url: 'https://x', user: { login: 'github-actions[bot]', type: 'Bot' } },
    });

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(200);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 400 for a signed body that is not JSON', async () => {
    const body = Buffer.from('payload=%7B%7D', 'utf-8');
    const headers = {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    };

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 500 when the secret cannot be loaded', async () => {
    mockGetParameter.mockRejectedValue(new Error('ParameterNotFound'));
    const { headers, body } = delivery('pull_request', mergedPayload);

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(500);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns 502 when Telegram delivery fails, so GitHub marks the delivery failed', async () => {
    mockSendMessage.mockRejectedValue(new Error('Failed to send message'));
    const { headers, body } = delivery('pull_request', mergedPayload);

    const result = await handleGitHubWebhook(headers, body);

    expect(result.statusCode).toBe(502);
  });
});
