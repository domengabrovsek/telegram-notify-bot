import { processMessage } from '@/services/message-processor';

vi.mock('@/services/config', () => ({
  getTelegramConfig: vi.fn(),
}));

vi.mock('@/services/telegram-client', () => ({
  sendMessage: vi.fn(),
}));

import { getTelegramConfig } from '@/services/config';
import { sendMessage } from '@/services/telegram-client';

const mockGetConfig = vi.mocked(getTelegramConfig);
const mockSendMessage = vi.mocked(sendMessage);

const defaultConfig = {
  botToken: 'test-token',
  adminChatId: '111',
  additionalChatIds: ['222', '333'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockResolvedValue(defaultConfig);
  mockSendMessage.mockResolvedValue();
});

describe('processMessage', () => {
  it('sends message for authorized API call', async () => {
    const body = JSON.stringify({ chat_id: '222', message: { text: 'hello' } });

    await processMessage(body);

    expect(mockSendMessage).toHaveBeenCalledWith('hello', '222', 'test-token');
  });

  it('sends message to admin chat ID', async () => {
    const body = JSON.stringify({ chat_id: '111', message: { text: 'admin msg' } });

    await processMessage(body);

    expect(mockSendMessage).toHaveBeenCalledWith('admin msg', '111', 'test-token');
  });

  it('ignores authorized Telegram webhook updates without sending', async () => {
    const body = JSON.stringify({
      message: { text: 'hello', chat: { id: 222 } },
    });

    await processMessage(body);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('sends security alert for unauthorized webhook', async () => {
    const body = JSON.stringify({
      message: {
        text: 'sneaky',
        chat: { id: 999 },
        from: { first_name: 'Bad', last_name: 'Actor', username: 'badactor' },
      },
    });

    await processMessage(body);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const alertText = mockSendMessage.mock.calls[0]?.[0];
    expect(alertText).toContain('Security Alert');
    expect(alertText).toContain('999');
    expect(alertText).toContain('Bad');
    expect(mockSendMessage.mock.calls[0]?.[1]).toBe('111'); // sent to admin
  });

  it('sends security alert for unauthorized API call and does not send message', async () => {
    const body = JSON.stringify({ chat_id: '999', message: { text: 'not allowed' } });

    await processMessage(body);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const alertText = mockSendMessage.mock.calls[0]?.[0];
    expect(alertText).toContain('Unauthorized API call');
    expect(alertText).toContain('999');
  });

  it('logs error when no chat_id is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = JSON.stringify({ message: { text: 'no chat' } });

    await processMessage(body);

    expect(consoleSpy).toHaveBeenCalledWith('No chat_id provided in request');
    expect(mockSendMessage).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('skips processing when message text is empty', async () => {
    const body = JSON.stringify({ chat_id: '222', message: { text: '   ' } });

    await processMessage(body);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('skips processing when message text is missing', async () => {
    const body = JSON.stringify({ chat_id: '222', message: {} });

    await processMessage(body);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('throws on invalid JSON body', async () => {
    await expect(processMessage('not json')).rejects.toThrow('Invalid JSON');
  });

  it('throws on body exceeding size limit', async () => {
    const body = 'x'.repeat(10_001);

    await expect(processMessage(body)).rejects.toThrow('too large');
  });

  it('does not crash if security alert fails to send', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('network error'));

    const body = JSON.stringify({
      message: { text: 'hack', chat: { id: 999 } },
    });

    // Should not throw even though sendMessage failed
    await processMessage(body);
  });
});
