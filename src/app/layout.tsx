import type { Metadata } from 'next';
import './globals.css';
import { PortalProvider } from '@/components/portal-context';
import { IntegrationUnavailable } from '@/components/integration-unavailable';

// Evaluate integration mode per request so a runtime LIVE setting can never serve a statically baked demo portal.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Baraka — B2B hamkorlar portali',
  description: 'B2B hamkorlar uchun buyurtmalar, shaxsiy narxlar va sodiqlik darajalari.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const liveMode = process.env.MOYSKLAD_MODE === 'live';
  return <html lang="uz"><body>{liveMode ? <IntegrationUnavailable /> : <PortalProvider>{children}</PortalProvider>}</body></html>;
}
