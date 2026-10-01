import { handler } from '@/handler';

vi.mock('@/services/message-processor', () => ({
  processMessage: vi.fn(),
}));

vi.mock('@/services/github-webhook', () => ({
  handleGitHubWebhook: vi.fn(),
}));

import { handleGitHubWebhook } from '@/services/github-webhook';
import { processMessage } from '@/services/message-processor';

const mockProcessMessage = vi.mocked(processMessage);
const mockHandleGitHubWebhook = vi.mocked(handleGitHubWebhook);

const functionUrlEvent = (
  body: string | undefined,
  isBase64Encoded = false,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) => ({
  version: '2.0',
  requestContext: { http: { method: 'POST' } },
  headers,
  body,
  isBase64Encoded,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handler', () => {
  describe('warmup events', () => {
    it('returns 200 for EventBridge warmup ping', async () => {
      const result = await handler({ source: 'aws.events' });

      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({ message: 'warmup' }),
      });
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });
  });

  describe('Function URL events', () => {
    it('processes the request body and returns 200', async () => {
      mockProcessMessage.mockResolvedValue();
      const body = '{"message":{"text":"hello"},"chat_id":"123"}';

      const result = await handler(functionUrlEvent(body));

      expect(result).toEqual({ statusCode: 200, body: JSON.stringify({ ok: true }) });
      expect(mockProcessMessage).toHaveBeenCalledWith(body);
    });

    it('decodes a base64-encoded body before processing', async () => {
      mockProcessMessage.mockResolvedValue();
      const body = '{"message":{"text":"hi"},"chat_id":"456"}';
      const encoded = Buffer.from(body, 'utf-8').toString('base64');

      const result = await handler(functionUrlEvent(encoded, true));

      expect(result).toEqual({ statusCode: 200, body: JSON.stringify({ ok: true }) });
      expect(mockProcessMessage).toHaveBeenCalledWith(body);
    });

    it('still returns 200 when processing throws (no queue retry)', async () => {
      mockProcessMessage.mockRejectedValue(new Error('send failed'));

      const result = await handler(functionUrlEvent('{"invalid":true}'));

      expect(result).toEqual({ statusCode: 200, body: JSON.stringify({ ok: true }) });
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    });

    it('processes an empty body as an empty string', async () => {
      mockProcessMessage.mockResolvedValue();

      const result = await handler(functionUrlEvent(undefined));

      expect(result).toEqual({ statusCode: 200, body: JSON.stringify({ ok: true }) });
      expect(mockProcessMessage).toHaveBeenCalledWith('');
    });
  });

  describe('GitHub webhook events', () => {
    it('routes requests with an x-github-event header to the GitHub handler with the raw bytes', async () => {
      const response = { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
      mockHandleGitHubWebhook.mockResolvedValue(response);
      const body = '{"action":"opened"}';
      const headers = { 'x-github-event': 'pull_request', 'x-hub-signature-256': 'sha256=abc' };

      const result = await handler(functionUrlEvent(body, false, headers));

      expect(result).toEqual(response);
      expect(mockHandleGitHubWebhook).toHaveBeenCalledWith(headers, Buffer.from(body, 'utf-8'));
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('decodes a base64-encoded GitHub body to its original bytes', async () => {
      mockHandleGitHubWebhook.mockResolvedValue({ statusCode: 200, body: '{}' });
      const body = '{"zen":"hi"}';
      const headers = { 'x-github-event': 'ping' };

      await handler(functionUrlEvent(Buffer.from(body).toString('base64'), true, headers));

      expect(mockHandleGitHubWebhook).toHaveBeenCalledWith(headers, Buffer.from(body, 'utf-8'));
    });

    it('keeps requests without the header on the Telegram path', async () => {
      mockProcessMessage.mockResolvedValue();

      await handler(functionUrlEvent('{"message":{"text":"hello"},"chat_id":"123"}'));

      expect(mockHandleGitHubWebhook).not.toHaveBeenCalled();
      expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalid events', () => {
    it('returns 400 for unrecognized event shapes', async () => {
      const result = await handler({});

      expect(result).toEqual({
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid event' }),
      });
    });
  });
});
