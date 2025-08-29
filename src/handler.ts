import { sendMessage, type TelegramMessage } from './telegram';
import { parseJson } from './utils';

export const handler = async (event: { body: string}) => {
  try {
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

    // Security: Only allow messages from the configured chat ID
    const allowedChatId = process.env.TELEGRAM_CHAT_ID;
    const messageChatId = body.message.chat.id.toString();
    
    if (!allowedChatId || messageChatId !== allowedChatId) {
      console.warn(`Unauthorized message from chat ID: ${messageChatId}, expected: ${allowedChatId}`);
      
      // Send security alert to authorized user
      const alertMessage = `🚨 Security Alert: Unauthorized bot access attempt
      
Chat ID: ${messageChatId}
User: ${body.message.from?.first_name || 'Unknown'} ${body.message.from?.last_name || ''} (@${body.message.from?.username || 'no-username'})
Message: "${body.message.text}"
Time: ${new Date().toISOString()}`;

      try {
        await sendMessage(alertMessage);
      } catch (error) {
        console.error('Failed to send security alert:', error);
      }
      
      return { statusCode: 200, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    // Sanitize message text
    const message = body.message.text.trim();
    
    if (message.length === 0) {
      console.warn('Empty message received');
      return { statusCode: 200, body: JSON.stringify({ message: 'Empty message ignored' }) };
    }

    await sendMessage(message);
    
    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: 'Message sent successfully' }) 
    };
  } catch (error) {
    console.error('Handler error:', error instanceof Error ? error.message : 'Unknown error');
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Internal server error' }) 
    };
  }
};
