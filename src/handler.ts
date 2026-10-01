import { handleGitHubWebhook } from '@/services/github-webhook';
import { processMessage } from '@/services/message-processor';
import type { HttpResponse, LambdaEvent } from '@/types';

/* Lambda entry point. Handles Telegram webhook / direct-API POSTs and GitHub
   repository webhooks delivered via the Lambda Function URL, plus EventBridge
   warmup pings. */
export async function handler(event: LambdaEvent): Promise<HttpResponse> {
  // EventBridge warmup ping - return immediately without any processing
  if ('source' in event && event.source === 'aws.events') {
    return { statusCode: 200, body: JSON.stringify({ message: 'warmup' }) };
  }

  // Function URL HTTP request (Telegram webhook, direct API call, or GitHub webhook)
  if ('requestContext' in event) {
    const bodyBytes =
      event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64') : Buffer.from(event.body ?? '', 'utf-8');

    // The signature covers the exact request bytes, so GitHub gets the undecoded buffer
    if (event.headers?.['x-github-event']) {
      return handleGitHubWebhook(event.headers, bodyBytes);
    }

    try {
      await processMessage(bodyBytes.toString('utf-8'));
    } catch (error) {
      /* No SQS/DLQ backs the Function URL, so a failure is logged here and the
         request still returns 200 - Telegram retries webhooks on any non-2xx. */
      console.error('Failed to process message:', error instanceof Error ? error.message : 'Unknown error');
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid event' }) };
}
