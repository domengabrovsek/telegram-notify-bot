// SQS event types for Lambda invocation
export interface SQSRecord {
  messageId: string;
  body: string;
  eventSource: string;
}

export interface SQSEvent {
  Records: SQSRecord[];
}

export interface SQSBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

export interface WarmupEvent {
  source?: string;
}

export type LambdaEvent = SQSEvent | WarmupEvent;

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
