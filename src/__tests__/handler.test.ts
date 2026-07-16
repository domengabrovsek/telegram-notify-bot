import { handler } from '@/handler';

vi.mock('@/services/message-processor', () => ({
  processMessage: vi.fn(),
}));

import { processMessage } from '@/services/message-processor';

const mockProcessMessage = vi.mocked(processMessage);

const functionUrlEvent = (body: string | undefined, isBase64Encoded = false) => ({
  version: '2.0',
  requestContext: { http: { method: 'POST' } },
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
