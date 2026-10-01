// EventBridge warmup ping
export interface WarmupEvent {
  source?: string;
}

/* Lambda Function URL request (payload format 2.0), trimmed to the fields the
   handler reads. Telegram, the notify workflows and GitHub webhooks POST here.
   Function URLs deliver header names lowercased. */
export interface FunctionUrlEvent {
  version: string;
  requestContext: {
    http: {
      method: string;
    };
  };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export type LambdaEvent = WarmupEvent | FunctionUrlEvent;

export interface HttpResponse {
  statusCode: number;
  body: string;
}

/* GitHub webhook payload, trimmed to the fields the PR notifications read.
   Every field is optional because one interface covers several event shapes. */
export interface GitHubUser {
  login?: string;
  type?: string;
}

export interface GitHubPullRequest {
  title?: string;
  html_url?: string;
  user?: GitHubUser;
  head?: { ref?: string };
  base?: { ref?: string };
  merged?: boolean;
  commits?: number;
}

export interface GitHubWebhookPayload {
  action?: string;
  repository?: { html_url?: string; default_branch?: string };
  pull_request?: GitHubPullRequest;
  issue?: { title?: string; pull_request?: unknown };
  comment?: { body?: string | null; html_url?: string; path?: string; user?: GitHubUser };
  review?: { state?: string; user?: GitHubUser };
  requested_reviewer?: GitHubUser;
}

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
