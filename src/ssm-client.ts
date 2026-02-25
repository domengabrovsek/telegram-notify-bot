import { SSMClient, GetParameterCommand, GetParameterCommandInput } from '@aws-sdk/client-ssm';

// Initialize SSM client (reuses connection across invocations in same container)
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'eu-central-1' });

// In-memory parameter cache (persists across warm Lambda invocations)
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

/**
 * Fetches a parameter from AWS Systems Manager Parameter Store
 * @param parameterName - Full parameter name (e.g., /telegram-notify-bot/bot-token)
 * @param description - Human-readable description for error messages
 * @returns Parameter value
 * @throws Error if parameter doesn't exist or cannot be fetched
 */
export async function getParameter(parameterName: string, description: string): Promise<string> {
  const cached = getCachedValue(parameterName);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const input: GetParameterCommandInput = {
      Name: parameterName,
      WithDecryption: true, // Decrypt SecureString parameters
    };

    const command = new GetParameterCommand(input);
    const response = await ssmClient.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterName} exists but has no value`);
    }

    setCachedValue(parameterName, response.Parameter.Value);
    return response.Parameter.Value;
  } catch (error) {
    // Enhanced error messages for different failure scenarios
    if (error instanceof Error) {
      if (error.name === 'ParameterNotFound') {
        throw new Error(
          `Configuration error: ${description} not found in Parameter Store (${parameterName}). ` +
          `Please ensure the parameter exists and Lambda has SSM permissions.`
        );
      }
      if (error.name === 'AccessDeniedException') {
        throw new Error(
          `Permission error: Lambda function cannot access ${description} (${parameterName}). ` +
          `Please check IAM role has ssm:GetParameter and kms:Decrypt permissions.`
        );
      }
      // Preserve original error for other cases
      throw new Error(
        `Failed to fetch ${description} from Parameter Store: ${error.message}`
      );
    }
    throw new Error(`Unknown error fetching ${description} from Parameter Store`);
  }
}

/**
 * Fetches all Telegram configuration from Parameter Store
 * @returns Object with bot token, admin chat ID, and additional chat IDs array
 */
export async function getTelegramConfig() {
  // Fetch all parameters (cached in-memory with 5-min TTL)
  const [botToken, adminChatId, additionalChatIds] = await Promise.all([
    getParameter('/telegram-notify-bot/bot-token', 'Telegram bot token'),
    getParameter('/telegram-notify-bot/admin-chat-id', 'Admin chat ID'),
    getParameter('/telegram-notify-bot/additional-chat-ids', 'Additional chat IDs'),
  ]);

  // Parse additional chat IDs (handle "none" default value)
  const additionalChatIdArray =
    additionalChatIds === 'none' || additionalChatIds.trim() === ''
      ? []
      : additionalChatIds.split(',').map(id => id.trim()).filter(Boolean);

  return {
    botToken,
    adminChatId,
    additionalChatIds: additionalChatIdArray,
  };
}
