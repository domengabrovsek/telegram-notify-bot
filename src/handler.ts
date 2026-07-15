import { processMessage } from '@/services/message-processor';
import type { LambdaEvent } from '@/types';

/* Lambda entry point. Handles Telegram webhook / direct-API POSTs delivered via
   the Lambda Function URL, plus EventBridge warmup pings. */
export async function handler(event: LambdaEvent): Promise<{ statusCode: number; body: string }> {
  // EventBridge warmup ping - return immediately without any processing
  if ('source' in event && event.source === 'aws.events') {
    return { statusCode: 200, body: JSON.stringify({ message: 'warmup' }) };
  }

  // Function URL HTTP request (Telegram webhook or direct API call)
  if ('requestContext' in event) {
    const rawBody =
      event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf-8') : (event.body ?? '');

    try {
      await processMessage(rawBody);
    } catch (error) {
      /* No SQS/DLQ backs the Function URL, so a failure is logged here and the
         request still returns 200 - Telegram retries webhooks on any non-2xx. */
      console.error('Failed to process message:', error instanceof Error ? error.message : 'Unknown error');
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid event' }) };
}
