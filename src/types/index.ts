// EventBridge warmup ping
export interface WarmupEvent {
  source?: string;
}

/* Lambda Function URL request (payload format 2.0), trimmed to the fields the
   handler reads. Telegram and the notify workflows POST the message body here. */
export interface FunctionUrlEvent {
  version: string;
  requestContext: {
    http: {
      method: string;
    };
  };
  body?: string;
  isBase64Encoded?: boolean;
}

export type LambdaEvent = WarmupEvent | FunctionUrlEvent;

// Telegram webhook/API message structure
export interface TelegramFrom {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name: string;
  username: string;
  language_code: string;
}

export interface TelegramChat {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  type: string;
}

export interface TelegramMessage {
  update_id?: number;
  chat_id?: string;
  message: {
    message_id?: number;
    from?: TelegramFrom;
    chat?: TelegramChat;
    date?: number;
    text: string;
  };
}

// Configuration returned from SSM Parameter Store
export interface TelegramConfig {
  botToken: string;
  adminChatId: string;
  additionalChatIds: string[];
}
