import { request } from 'undici';
import { setTimeout as sleep } from 'node:timers/promises';

export interface TelegramMessage {
  update_id?: number;
  chat_id?: string; // For direct API calls
  message: {
    message_id?: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name: string;
      username: string;
      language_code: string;
    };
    chat?: {
      id: number;
      first_name: string;
      last_name: string;
      username: string;
      type: string;
    };
    date?: number;
    text: string;
  };
}

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

function isRetryable(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

export const sendMessage = async (text: string, chatId: string, botToken: string) => {
  if (!text || typeof text !== 'string') return;

  // Validate message length (Telegram limit is 4096 characters)
  if (text.length > 4096) {
    throw new Error('Message too long');
  }

  if (!botToken) {
    throw new Error('Bot token is not provided');
  }

  if (!chatId) {
    throw new Error('chat_id is required');
  }

  // Use POST request with JSON body instead of query parameters to avoid token exposure in logs
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { statusCode, body } = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: text
          // No parse_mode - send as plain text to avoid parsing errors
        })
      });

      if (statusCode === 200) {
        return;
      }

      const responseBody = await body.json() as Record<string, unknown>;

      // Don't retry 4xx client errors (except 429 rate limit)
      if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        console.error('Failed to send Telegram message:', {
          statusCode,
          error: (responseBody?.description as string) || 'Unknown error'
        });
        throw new Error('Failed to send message');
      }

      if (isRetryable(statusCode) && attempt < MAX_RETRIES) {
        const retryAfter = statusCode === 429 && typeof responseBody?.retry_after === 'number'
          ? (responseBody.retry_after as number) * 1000
          : BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`Telegram API returned ${statusCode}, retrying in ${retryAfter}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(retryAfter);
        continue;
      }

      console.error('Failed to send Telegram message:', {
        statusCode,
        error: (responseBody?.description as string) || 'Unknown error'
      });
      lastError = new Error('Failed to send message');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // Network errors (DNS, timeout) are retryable
      if (attempt < MAX_RETRIES && lastError.message !== 'Failed to send message') {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`Network error sending Telegram message, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`, lastError.message);
        await sleep(backoff);
        continue;
      }

      console.error('Error sending message to Telegram:', lastError.message);
    }
  }

  throw lastError ?? new Error('Failed to send message');
};
