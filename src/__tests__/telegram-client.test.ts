// Mock fetch before importing the module under test
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock timers for sleep/retry testing
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

import { sendMessage } from '@/services/telegram-client';

function mockResponse(status: number, body: Record<string, unknown> = {}) {
  return {
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendMessage', () => {
  it('sends message successfully on 200', async () => {
    mockFetch.mockResolvedValue(mockResponse(200));

    await sendMessage('hello', '123', 'token');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.telegram.org/bottoken/sendMessage');
    expect(JSON.parse(options?.body as string)).toEqual({ chat_id: '123', text: 'hello' });
  });

  it('returns early for empty text', async () => {
    await sendMessage('', '123', 'token');

    expect(mockFetch).not.toHaveBeenCalled();
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
    mockFetch.mockResolvedValue(mockResponse(400, { description: 'Bad Request' }));

    await expect(sendMessage('hello', '123', 'token')).rejects.toThrow('Failed to send message');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(429, { retry_after: 1 })).mockResolvedValueOnce(mockResponse(200));

    await sendMessage('hello', '123', 'token');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx server errors', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500, { description: 'Internal Error' }))
      .mockResolvedValueOnce(mockResponse(200));

    await sendMessage('hello', '123', 'token');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(mockResponse(200));

    await sendMessage('hello', '123', 'token');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500))
      .mockResolvedValueOnce(mockResponse(500));

    await expect(sendMessage('hello', '123', 'token')).rejects.toThrow('Failed to send message');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
