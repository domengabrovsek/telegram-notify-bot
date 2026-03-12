// Mock undici before importing the module under test
vi.mock('undici', () => ({
  request: vi.fn(),
}));

// Mock timers for sleep/retry testing
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

import { request } from 'undici';
import { sendMessage } from '@/services/telegram-client';

const mockRequest = vi.mocked(request);

function mockResponse(statusCode: number, body: Record<string, unknown> = {}) {
  return {
    statusCode,
    body: { json: vi.fn().mockResolvedValue(body) },
    headers: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendMessage', () => {
  it('sends message successfully on 200', async () => {
    mockRequest.mockResolvedValue(mockResponse(200) as never);

    await sendMessage('hello', '123', 'token');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const call = mockRequest.mock.calls[0];
    const [url, options] = call ?? [];
    expect(url).toBe('https://api.telegram.org/bottoken/sendMessage');
    expect(JSON.parse(options?.body as string)).toEqual({ chat_id: '123', text: 'hello' });
  });

  it('returns early for empty text', async () => {
    await sendMessage('', '123', 'token');

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('throws for message exceeding 4096 chars', async () => {
    await expect(sendMessage('x'.repeat(4097), '123', 'token')).rejects.toThrow('Message too long');
  });

  it('throws when bot token is missing', async () => {
    await expect(sendMessage('hello', '123', '')).rejects.toThrow('Bot token is not provided');
  });

  it('throws when chat_id is missing', async () => {
    await expect(sendMessage('hello', '', 'token')).rejects.toThrow('chat_id is required');
  });

  it('throws on 4xx errors without retry', async () => {
    mockRequest.mockResolvedValue(mockResponse(400, { description: 'Bad Request' }) as never);

    await expect(sendMessage('hello', '123', 'token')).rejects.toThrow('Failed to send message');
    // 4xx throws inside the try, caught by catch, which sees "Failed to send message" and does not retry
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 rate limit', async () => {
    mockRequest
      .mockResolvedValueOnce(mockResponse(429, { retry_after: 1 }) as never)
      .mockResolvedValueOnce(mockResponse(200) as never);

    await sendMessage('hello', '123', 'token');

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx server errors', async () => {
    mockRequest
      .mockResolvedValueOnce(mockResponse(500, { description: 'Internal Error' }) as never)
      .mockResolvedValueOnce(mockResponse(200) as never);

    await sendMessage('hello', '123', 'token');

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(mockResponse(200) as never);

    await sendMessage('hello', '123', 'token');

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    mockRequest
      .mockResolvedValueOnce(mockResponse(500) as never)
      .mockResolvedValueOnce(mockResponse(500) as never)
      .mockResolvedValueOnce(mockResponse(500) as never);

    await expect(sendMessage('hello', '123', 'token')).rejects.toThrow('Failed to send message');
    expect(mockRequest).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
