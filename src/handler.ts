import { processMessage } from '@/services/message-processor';
import type { LambdaEvent, SQSBatchResponse } from '@/types';

// Lambda entry point. Routes SQS messages to the processor and handles EventBridge warmup pings.
export async function handler(event: LambdaEvent): Promise<SQSBatchResponse | { statusCode: number; body: string }> {
  // EventBridge warmup ping - return immediately without any processing
  if ('source' in event && event.source === 'aws.events') {
    return { statusCode: 200, body: JSON.stringify({ message: 'warmup' }) };
  }

  // SQS batch processing with partial failure reporting
  if ('Records' in event) {
    const failures: Array<{ itemIdentifier: string }> = [];

    for (const record of event.Records) {
      try {
        await processMessage(record.body);
      } catch (error) {
        console.error(
          `Failed to process message ${record.messageId}:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        failures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures: failures };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Invalid event' }) };
}
