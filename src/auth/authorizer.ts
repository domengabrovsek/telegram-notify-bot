import type { TelegramFrom } from '@/types';

export function isAuthorized(chatId: string, authorizedChatIds: string[]): boolean {
  return authorizedChatIds.includes(chatId);
}

export function buildSecurityAlert(
  type: 'webhook' | 'api',
  chatId: string,
  messageText: string,
  from?: TelegramFrom,
): string {
  const timestamp = new Date().toISOString();

  if (type === 'webhook') {
    const firstName = from?.first_name ?? 'Unknown';
    const lastName = from?.last_name ?? '';
    const username = from?.username ?? 'no-username';

    return [
      '\u{1F6A8} Security Alert: Unauthorized bot access attempt',
      '',
      `Chat ID: ${chatId}`,
      `User: ${firstName} ${lastName} (@${username})`,
      `Message: "${messageText}"`,
      `Time: ${timestamp}`,
    ].join('\n');
  }

  return [
    '\u{1F6A8} Security Alert: Unauthorized API call attempt',
    '',
    `Chat ID: ${chatId}`,
    `Message: "${messageText}"`,
    `Time: ${timestamp}`,
  ].join('\n');
}
