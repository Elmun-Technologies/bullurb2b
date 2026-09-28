export type IntegrationFailure = 'AUTHENTICATION' | 'PERMISSION' | 'UNAVAILABLE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INVALID_DATA' | 'UNCONFIGURED' | 'UNKNOWN';

const safeMessages: Record<IntegrationFailure, string> = {
  AUTHENTICATION: 'Ulanish tasdiqlanmadi. Administrator bilan bog‘laning.',
  PERMISSION: 'Ushbu ma’lumotni ko‘rishga ruxsat yo‘q.',
  UNAVAILABLE: 'Tashqi xizmat vaqtincha ishlamayapti. Birozdan so‘ng qayta urinib ko‘ring.',
  NOT_FOUND: 'So‘ralgan ma’lumot topilmadi.',
  RATE_LIMITED: 'So‘rovlar soni vaqtincha cheklangan. Birozdan so‘ng qayta urinib ko‘ring.',
  INVALID_DATA: 'Tashqi xizmatdan kutilmagan ma’lumot olindi.',
  UNCONFIGURED: 'Tashqi integratsiya hali sozlanmagan.',
  UNKNOWN: 'Kutilmagan xatolik yuz berdi. Administrator bilan bog‘laning.',
};

export class IntegrationError extends Error {
  constructor(readonly failure: IntegrationFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntegrationError';
  }
  get userMessage(): string { return safeMessages[this.failure]; }
}

export function safeIntegrationMessage(error: unknown): string {
  return error instanceof IntegrationError ? error.userMessage : safeMessages.UNKNOWN;
}
