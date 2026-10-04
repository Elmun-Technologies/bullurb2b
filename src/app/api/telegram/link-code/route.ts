import { getVerifiedPrincipal } from '@/lib/auth/access';
import { IntegrationError } from '@/lib/providers/errors';
import { getTelegramServerConfig, requireTelegramLinkingSecret } from '@/lib/telegram/config';
import { issueLinkCode, LinkAuthorizationError } from '@/lib/telegram/linking';
import { getTelegramStores } from '@/lib/telegram/stores';

/**
 * Issues a short-lived single-use Telegram linking code for the verified
 * portal session. Fail-closed: without Shopflow authentication, durable link
 * storage, or full Telegram configuration this returns 503/403 and never a
 * code. The demo role switcher is not authentication and cannot reach here.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const status = getTelegramServerConfig();
  if (status.status !== 'ready') {
    return Response.json({ ok: false, error: 'telegram-unconfigured', missing: status.missing }, { status: 503 });
  }

  let principal;
  try {
    principal = await getVerifiedPrincipal();
  } catch {
    return Response.json(
      { ok: false, error: 'auth-unconfigured', message: 'Shopflow authentication is not configured; demo identity cannot link Telegram.' },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = body?.locale === 'ru' ? 'ru' : 'uz';

  try {
    const issued = await issueLinkCode({ principal, stores: getTelegramStores(), linkingSecret: requireTelegramLinkingSecret(), botUsername: status.botUsername, locale });
    return Response.json({ ok: true, code: issued.code, deepLink: issued.deepLink, expiresAt: issued.expiresAt });
  } catch (error) {
    if (error instanceof LinkAuthorizationError) {
      return Response.json({ ok: false, error: 'link-forbidden', message: error.message }, { status: 403 });
    }
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      return Response.json({ ok: false, error: 'storage-unconfigured', message: error.userMessage }, { status: 503 });
    }
    return Response.json({ ok: false, error: 'link-failed' }, { status: 500 });
  }
}
