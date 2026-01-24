import { sendMessage, type TelegramMessage } from './telegram';
import { parseJson } from './utils';
import { getTelegramConfig } from './ssm-client';

export const handler = async (event: { body: string}) => {
  try {
    // Fetch configuration from Parameter Store (no caching per requirement)
    const config = await getTelegramConfig();
    // Validate event structure
    if (!event || !event.body || typeof event.body !== 'string') {
      console.error('Invalid event structure');
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
    }

    // Validate body length to prevent DoS attacks
    if (event.body.length > 10000) {
      console.error('Request body too large');
      return { statusCode: 413, body: JSON.stringify({ error: 'Request too large' }) };
    }

    const body = parseJson<TelegramMessage>(event.body);

    // Validate message structure
    if (!body.message?.text || typeof body.message.text !== 'string') {
      console.warn('No valid text message found in request');
      return { statusCode: 200, body: JSON.stringify({ message: 'No action taken' }) };
    }

    const message = body.message.text.trim();

    if (message.length === 0) {
      console.warn('Empty message received');
      return { statusCode: 200, body: JSON.stringify({ message: 'Empty message ignored' }) };
    }

    // Combine admin and additional chat IDs for authorization check
    const authorizedChatIds = [config.adminChatId, ...config.additionalChatIds];

    // Determine chat ID from request
    let targetChatId: string | undefined;

    if (body.message.chat?.id) {
      // This is a Telegram webhook - use the chat ID from the webhook
      targetChatId = body.message.chat.id.toString();

      // Validate against authorized chat IDs
      if (!authorizedChatIds.includes(targetChatId)) {
        console.warn(`Unauthorized webhook from chat ID: ${targetChatId}`);

        // Send security alert to admin chat
        const alertMessage = `🚨 Security Alert: Unauthorized bot access attempt

Chat ID: ${targetChatId}
User: ${body.message.from?.first_name || 'Unknown'} ${body.message.from?.last_name || ''} (@${body.message.from?.username || 'no-username'})
Message: "${body.message.text}"
Time: ${new Date().toISOString()}`;

        try {
          await sendMessage(alertMessage, config.adminChatId, config.botToken);
        } catch (error) {
          console.error('Failed to send security alert:', error);
        }

        return { statusCode: 200, body: JSON.stringify({ message: 'Unauthorized' }) };
      }
    } else if (body.chat_id) {
      // This is a direct API call - use the chat_id from the body
      targetChatId = body.chat_id;

      // Validate against authorized chat IDs
      if (!authorizedChatIds.includes(targetChatId)) {
        console.warn(`Unauthorized API call for chat ID: ${targetChatId}`);

        // Send security alert to admin chat
        const alertMessage = `🚨 Security Alert: Unauthorized API call attempt

Chat ID: ${targetChatId}
Message: "${body.message.text}"
Time: ${new Date().toISOString()}`;

        try {
          await sendMessage(alertMessage, config.adminChatId, config.botToken);
        } catch (error) {
          console.error('Failed to send security alert:', error);
        }

        return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized chat_id' }) };
      }
    } else {
      // No chat ID provided
      console.error('No chat_id provided in request');
      return { statusCode: 400, body: JSON.stringify({ error: 'chat_id is required' }) };
    }

    await sendMessage(message, targetChatId, config.botToken);
    console.log(`Message sent successfully to chat ${targetChatId}: ${message}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message sent successfully', chat_id: targetChatId })
    };
  } catch (error) {
    // Enhanced error logging for SSM failures
    if (error instanceof Error && error.message.includes('Parameter Store')) {
      console.error('Configuration error:', error.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error - check logs' })
      };
    }

    console.error('Handler error:', error instanceof Error ? error.message : 'Unknown error');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
