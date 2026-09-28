import 'server-only';
import { mockMoySkladProvider } from './mock-provider';
import { unconfiguredMoySkladProvider } from './moysklad-live-provider';

export const moySkladProvider = process.env.MOYSKLAD_MODE === 'live'
  ? unconfiguredMoySkladProvider
  : mockMoySkladProvider;
