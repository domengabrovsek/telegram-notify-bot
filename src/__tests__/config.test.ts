const mockSend = vi.fn();

vi.mock('@aws-sdk/client-ssm', async () => {
  return {
    SSMClient: class {
      send(...args: unknown[]) {
        return mockSend(...args);
      }
    },
    GetParameterCommand: class {
      input: { Name: string };
      constructor(input: { Name: string }) {
        this.input = input;
      }
    },
  };
});

import { clearCache, getParameter, getTelegramConfig } from '@/services/config';

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe('getParameter', () => {
  it('fetches and returns parameter value', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'my-token' } });

    const result = await getParameter('/test/param', 'Test param');

    expect(result).toBe('my-token');
  });

  it('returns cached value on second call', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'cached-value' } });

    await getParameter('/test/cached', 'Cached param');
    const result = await getParameter('/test/cached', 'Cached param');

    expect(result).toBe('cached-value');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache expiry', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: 'value-1' } });
    await getParameter('/test/ttl', 'TTL param');

    vi.useFakeTimers();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

    mockSend.mockResolvedValue({ Parameter: { Value: 'value-2' } });
    const result = await getParameter('/test/ttl', 'TTL param');

    expect(result).toBe('value-2');
    expect(mockSend).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws descriptive error for ParameterNotFound', async () => {
    const error = new Error('not found');
    error.name = 'ParameterNotFound';
    mockSend.mockRejectedValue(error);

    await expect(getParameter('/test/missing', 'Bot token')).rejects.toThrow(
      'Configuration error: Bot token not found in Parameter Store',
    );
  });

  it('throws descriptive error for AccessDeniedException', async () => {
    const error = new Error('access denied');
    error.name = 'AccessDeniedException';
    mockSend.mockRejectedValue(error);

    await expect(getParameter('/test/denied', 'Bot token')).rejects.toThrow(
      'Permission error: Lambda function cannot access Bot token',
    );
  });

  it('throws when parameter value is empty', async () => {
    mockSend.mockResolvedValue({ Parameter: { Value: undefined } });

    await expect(getParameter('/test/empty', 'Empty param')).rejects.toThrow('exists but has no value');
  });
});

describe('getTelegramConfig', () => {
  it('returns parsed config with all parameters', async () => {
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: 'bot-token-123' } })
      .mockResolvedValueOnce({ Parameter: { Value: '111' } })
      .mockResolvedValueOnce({ Parameter: { Value: '222,333, 444' } });

    const config = await getTelegramConfig();

    expect(config).toEqual({
      botToken: 'bot-token-123',
      adminChatId: '111',
      additionalChatIds: ['222', '333', '444'],
    });
  });

  it('returns empty array when additional chat IDs is "none"', async () => {
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: 'token' } })
      .mockResolvedValueOnce({ Parameter: { Value: '111' } })
      .mockResolvedValueOnce({ Parameter: { Value: 'none' } });

    const config = await getTelegramConfig();

    expect(config.additionalChatIds).toEqual([]);
  });

  it('returns empty array when additional chat IDs is empty string', async () => {
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: 'token' } })
      .mockResolvedValueOnce({ Parameter: { Value: '111' } })
      .mockResolvedValueOnce({ Parameter: { Value: '  ' } });

    const config = await getTelegramConfig();

    expect(config.additionalChatIds).toEqual([]);
  });
});
