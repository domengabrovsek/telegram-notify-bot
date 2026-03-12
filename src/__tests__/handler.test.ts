import { handler } from '@/handler';

vi.mock('@/services/message-processor', () => ({
  processMessage: vi.fn(),
}));

import { processMessage } from '@/services/message-processor';

const mockProcessMessage = vi.mocked(processMessage);

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

  describe('SQS events', () => {
    it('processes all records successfully', async () => {
      mockProcessMessage.mockResolvedValue();

      const result = await handler({
        Records: [
          { messageId: 'msg-1', body: '{"message":{"text":"hello"},"chat_id":"123"}', eventSource: 'aws:sqs' },
          { messageId: 'msg-2', body: '{"message":{"text":"world"},"chat_id":"456"}', eventSource: 'aws:sqs' },
        ],
      });

      expect(result).toEqual({ batchItemFailures: [] });
      expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    });

    it('reports failed records as batch item failures', async () => {
      mockProcessMessage.mockResolvedValueOnce();
      mockProcessMessage.mockRejectedValueOnce(new Error('send failed'));

      const result = await handler({
        Records: [
          { messageId: 'msg-1', body: '{"message":{"text":"ok"},"chat_id":"123"}', eventSource: 'aws:sqs' },
          { messageId: 'msg-2', body: 'invalid', eventSource: 'aws:sqs' },
        ],
      });

      expect(result).toEqual({
        batchItemFailures: [{ itemIdentifier: 'msg-2' }],
      });
    });

    it('handles empty records array', async () => {
      const result = await handler({ Records: [] });

      expect(result).toEqual({ batchItemFailures: [] });
      expect(mockProcessMessage).not.toHaveBeenCalled();
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
