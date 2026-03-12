import { buildSecurityAlert, isAuthorized } from '@/auth/authorizer';
import { getTelegramConfig } from '@/services/config';
import { sendMessage } from '@/services/telegram-client';
import { extractMessageText, parseAndValidateBody } from '@/validators/message-validator';

// Processes a single raw message body from the SQS queue.
// Handles both Telegram webhook updates and direct API calls.
export async function processMessage(rawBody: string): Promise<void> {
  const config = await getTelegramConfig();
  const body = parseAndValidateBody(rawBody);
  const messageText = extractMessageText(body);

  if (!messageText) {
    console.warn('No valid text message found in request');
    return;
  }

  const authorizedChatIds = [config.adminChatId, ...config.additionalChatIds];

  // Telegram webhook update - never echo back, only alert on unauthorized access
  if (body.message.chat?.id) {
    const chatId = body.message.chat.id.toString();

    if (!isAuthorized(chatId, authorizedChatIds)) {
      console.warn(`Unauthorized webhook from chat ID: ${chatId}`);
      const alert = buildSecurityAlert('webhook', chatId, body.message.text, body.message.from);

      try {
        await sendMessage(alert, config.adminChatId, config.botToken);
      } catch (error) {
        console.error('Failed to send security alert:', error);
      }
    }

    return;
  }

  // Direct API call - requires explicit chat_id
  if (body.chat_id) {
    if (!isAuthorized(body.chat_id, authorizedChatIds)) {
      console.warn(`Unauthorized API call for chat ID: ${body.chat_id}`);
      const alert = buildSecurityAlert('api', body.chat_id, body.message.text);

      try {
        await sendMessage(alert, config.adminChatId, config.botToken);
      } catch (error) {
        console.error('Failed to send security alert:', error);
      }

      return;
    }

    await sendMessage(messageText, body.chat_id, config.botToken);
    console.log(`Message sent successfully to chat ${body.chat_id}: ${messageText}`);
    return;
  }

  console.error('No chat_id provided in request');
}
