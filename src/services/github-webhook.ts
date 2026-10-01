import { isValidGitHubSignature } from '@/auth/github-signature';
import { getParameter, getTelegramConfig } from '@/services/config';
import { buildGitHubMessage } from '@/services/github-message';
import { sendMessage } from '@/services/telegram-client';
import type { GitHubWebhookPayload, HttpResponse } from '@/types';

const WEBHOOK_SECRET_PARAMETER = '/telegram-notify-bot/github-webhook-secret';

function respond(statusCode: number, body: Record<string, unknown>): HttpResponse {
  return { statusCode, body: JSON.stringify(body) };
}

/* Handles a GitHub repository webhook delivered to the Function URL. A failure
   after the signature check returns 5xx on purpose: GitHub does not retry on its
   own, and a failed delivery stays visible and redeliverable in the webhook UI. */
export async function handleGitHubWebhook(
  headers: Record<string, string | undefined>,
  rawBody: Buffer,
): Promise<HttpResponse> {
  const event = headers['x-github-event'] ?? '';
  const delivery = headers['x-github-delivery'] ?? 'unknown';

  let secret: string;
  try {
    secret = await getParameter(WEBHOOK_SECRET_PARAMETER, 'GitHub webhook secret');
  } catch (error) {
    console.error('Failed to load GitHub webhook secret:', error instanceof Error ? error.message : 'Unknown error');
    return respond(500, { error: 'Internal error' });
  }

  if (!isValidGitHubSignature(rawBody, headers['x-hub-signature-256'], secret)) {
    console.warn(`Rejected GitHub webhook with invalid signature (event: ${event}, delivery: ${delivery})`);
    return respond(401, { error: 'Invalid signature' });
  }

  if (event === 'ping') {
    return respond(200, { ok: true });
  }

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8')) as GitHubWebhookPayload;
  } catch {
    console.warn(`GitHub webhook body is not JSON (event: ${event}, delivery: ${delivery})`);
    return respond(400, { error: 'Invalid JSON body' });
  }

  const message = buildGitHubMessage(event, payload);
  if (!message) {
    return respond(200, { ok: true, ignored: true });
  }

  try {
    const config = await getTelegramConfig();
    await sendMessage(message, config.adminChatId, config.botToken);
  } catch (error) {
    console.error(
      `Failed to send GitHub notification (event: ${event}, delivery: ${delivery}):`,
      error instanceof Error ? error.message : 'Unknown error',
    );
    return respond(502, { error: 'Failed to send notification' });
  }

  console.log(`GitHub notification sent (event: ${event}, action: ${payload.action ?? ''}, delivery: ${delivery})`);
  return respond(200, { ok: true });
}
