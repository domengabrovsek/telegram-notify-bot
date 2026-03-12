import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { TelegramConfig } from '@/types';

// Reuses connection across Lambda invocations in the same container
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'eu-central-1' });

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const parameterCache = new Map<string, CacheEntry>();

function getCachedValue(key: string): string | undefined {
  const entry = parameterCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  parameterCache.delete(key);
  return undefined;
}

function setCachedValue(key: string, value: string): void {
  parameterCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Exported for testing - allows clearing the cache between test runs
export function clearCache(): void {
  parameterCache.clear();
}

/**
 * Fetches a parameter from AWS Systems Manager Parameter Store.
 * Results are cached in-memory for 24 hours to reduce SSM API calls.
 */
export async function getParameter(parameterName: string, description: string): Promise<string> {
  const cached = getCachedValue(parameterName);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    });

    const response = await ssmClient.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterName} exists but has no value`);
    }

    setCachedValue(parameterName, response.Parameter.Value);
    return response.Parameter.Value;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'ParameterNotFound') {
        throw new Error(
          `Configuration error: ${description} not found in Parameter Store (${parameterName}). ` +
            'Please ensure the parameter exists and Lambda has SSM permissions.',
        );
      }
      if (error.name === 'AccessDeniedException') {
        throw new Error(
          `Permission error: Lambda function cannot access ${description} (${parameterName}). ` +
            'Please check IAM role has ssm:GetParameter and kms:Decrypt permissions.',
        );
      }
      throw new Error(`Failed to fetch ${description} from Parameter Store: ${error.message}`);
    }
    throw new Error(`Unknown error fetching ${description} from Parameter Store`);
  }
}

/**
 * Fetches all Telegram configuration from Parameter Store.
 * All three parameters are fetched concurrently and cached independently.
 */
export async function getTelegramConfig(): Promise<TelegramConfig> {
  const [botToken, adminChatId, additionalChatIds] = await Promise.all([
    getParameter('/telegram-notify-bot/bot-token', 'Telegram bot token'),
    getParameter('/telegram-notify-bot/admin-chat-id', 'Admin chat ID'),
    getParameter('/telegram-notify-bot/additional-chat-ids', 'Additional chat IDs'),
  ]);

  const additionalChatIdArray =
    additionalChatIds === 'none' || additionalChatIds.trim() === ''
      ? []
      : additionalChatIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);

  return { botToken, adminChatId, additionalChatIds: additionalChatIdArray };
}
