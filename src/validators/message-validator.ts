import type { TelegramMessage } from '@/types';

const MAX_BODY_LENGTH = 10_000;

export function parseAndValidateBody(rawBody: string): TelegramMessage {
  if (!rawBody || typeof rawBody !== 'string') {
    throw new Error('Invalid message body: expected a non-empty string');
  }

  if (rawBody.length > MAX_BODY_LENGTH) {
    throw new Error(`Message body too large: ${rawBody.length} chars exceeds ${MAX_BODY_LENGTH} limit`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON in request body');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('message' in parsed) ||
    !parsed.message ||
    typeof parsed.message !== 'object'
  ) {
    throw new Error('Invalid message structure: missing "message" field');
  }

  return parsed as TelegramMessage;
}

export function extractMessageText(body: TelegramMessage): string | null {
  if (!body.message?.text || typeof body.message.text !== 'string') {
    return null;
  }

  const trimmed = body.message.text.trim();
  return trimmed.length > 0 ? trimmed : null;
}
