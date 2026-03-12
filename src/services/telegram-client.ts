import { setTimeout as sleep } from 'node:timers/promises';

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const MAX_MESSAGE_LENGTH = 4096;

function isRetryable(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

// Sends a plain-text message via the Telegram Bot API with exponential backoff retry.
// Uses POST with JSON body to avoid leaking the bot token in URL query parameters.
export async function sendMessage(text: string, chatId: string, botToken: string): Promise<void> {
  if (!text || typeof text !== 'string') return;

  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message too long: ${text.length} chars exceeds ${MAX_MESSAGE_LENGTH} limit`);
  }

  if (!botToken) {
    throw new Error('Bot token is not provided');
  }

  if (!chatId) {
    throw new Error('chat_id is required');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });

      if (response.status === 200) {
        return;
      }

      const responseBody = (await response.json()) as Record<string, unknown>;
      const errorDescription = (responseBody?.description as string) || 'Unknown error';

      // 4xx client errors (except 429 rate limit) are not retryable
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        console.error('Failed to send Telegram message:', { statusCode: response.status, error: errorDescription });
        throw new Error('Failed to send message');
      }

      if (isRetryable(response.status) && attempt < MAX_RETRIES) {
        const retryAfter =
          response.status === 429 && typeof responseBody?.retry_after === 'number'
            ? (responseBody.retry_after as number) * 1000
            : BASE_BACKOFF_MS * 2 ** attempt;
        console.warn(
          `Telegram API returned ${response.status}, retrying in ${retryAfter}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await sleep(retryAfter);
        continue;
      }

      console.error('Failed to send Telegram message:', { statusCode: response.status, error: errorDescription });
      lastError = new Error('Failed to send message');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // Network errors (DNS, timeout) are retryable - application errors are not
      if (attempt < MAX_RETRIES && lastError.message !== 'Failed to send message') {
        const backoff = BASE_BACKOFF_MS * 2 ** attempt;
        console.warn(
          `Network error sending Telegram message, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`,
          lastError.message,
        );
        await sleep(backoff);
        continue;
      }

      console.error('Error sending message to Telegram:', lastError.message);
      break;
    }
  }

  throw lastError ?? new Error('Failed to send message');
}
