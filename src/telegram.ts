import { request } from 'undici';

export interface TelegramMessage {
  update_id: number;
  message: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name: string;
      username: string;
      language_code: string;
    };
    chat: {
      id: number;
      first_name: string;
      last_name: string;
      username: string;
      type: string;
    };
    date: number;
    text: string;
  };
}

export const sendMessage = async (text: string) => {
  if (!text || typeof text !== 'string') return;

  // Validate message length (Telegram limit is 4096 characters)
  if (text.length > 4096) {
    throw new Error('Message too long');
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set');
  }

  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID is not set');
  }

  // Use POST request with JSON body instead of query parameters to avoid token exposure in logs
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  try {
    const { statusCode, body } = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML' // Allow basic HTML formatting
      })
    });

    if (statusCode !== 200) {
      const responseBody = await body.json() as any;
      console.error('Failed to send Telegram message:', {
        statusCode,
        error: responseBody?.description || 'Unknown error'
      });
      throw new Error('Failed to send message');
    }
  } catch (error) {
    console.error('Error sending message to Telegram:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
};