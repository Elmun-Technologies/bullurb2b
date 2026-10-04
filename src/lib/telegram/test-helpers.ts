import { vi } from 'vitest';

/** Distinctive fake secrets shared by telegram tests (never real credentials). */
export const TEST_SECRETS = {
  botToken: 'FAKETOKEN:token-value-abcdef-123456',
  webhookSecret: 'webhook-SECRET-value-abcdef',
  linkingSecret: 'linking-SECRET-value-abcdef0123456789',
  cronSecret: 'cron-SECRET-value-abcdef0123456789',
};

export function stubFullTelegramEnv() {
  vi.stubEnv('TELEGRAM_ENABLED', 'true');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', TEST_SECRETS.botToken);
  vi.stubEnv('TELEGRAM_BOT_USERNAME', 'BarakaTestBot');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', TEST_SECRETS.webhookSecret);
  vi.stubEnv('TELEGRAM_LINKING_SECRET', TEST_SECRETS.linkingSecret);
  vi.stubEnv('TELEGRAM_CRON_SECRET', TEST_SECRETS.cronSecret);
}
