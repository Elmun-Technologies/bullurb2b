import type { MetricType } from '@/lib/domain/types';
import type { TelegramLocale, TelegramReplyKeyboardMarkup, TelegramReplyKeyboardRemove } from './types';

/**
 * Telegram message texts (Uzbek Latin first, Russian supported).
 *
 * Messages are plain text on purpose: no `parse_mode` is used, so customer and
 * company names can never break formatting or inject entities. Only the data
 * the recipient is authorized for is included — never contact details such as
 * phone numbers or emails.
 */

/** Bot API `sendMessage` accepts 1–4096 characters of text. */
export const TELEGRAM_MAX_TEXT_LENGTH = 4096;

export function truncateTelegramText(text: string, maxLength = TELEGRAM_MAX_TEXT_LENGTH): string {
  const normalized = text.replace(/\s+$/u, '');
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/\s+$/u, '')}…`;
}

function formatGap(value: number, metric: MetricType, locale: TelegramLocale): string {
  const amount = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'uz-UZ', { maximumFractionDigits: 0 }).format(Math.round(value));
  if (metric === 'boxes') return locale === 'ru' ? `${amount} коробок` : `${amount} quti`;
  return locale === 'ru' ? `${amount} сум` : `${amount} so‘m`;
}

export function buildFridayGreeting(locale: TelegramLocale, companyName: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `С благословенной пятницей!\nКоманде ${companyName} желаем успешной торговой недели.`
      : `Juma muborak!\n${companyName} jamoasiga fayzli juma va barakali savdo haftasi tilaymiz.`,
  );
}

export function buildTierGapMessage(
  locale: TelegramLocale,
  input: { currentValue: number; remaining: number; nextTierName: string; discountPercent: number; metric: MetricType },
): string {
  const current = formatGap(input.currentValue, input.metric, locale);
  const gap = formatGap(input.remaining, input.metric, locale);
  return truncateTelegramText(
    locale === 'ru'
      ? `До уровня ${input.nextTierName} осталось ${gap}.\nТекущий объём: ${current}. На уровне ${input.nextTierName} скидка составит ${input.discountPercent}%.`
      : `${input.nextTierName} darajasigacha ${gap} qoldi.\nHozir ${current} xarid qilgansiz. ${input.nextTierName} darajasida chegirma ${input.discountPercent}% bo‘ladi.`,
  );
}

export function buildOrderStatusMessage(
  locale: TelegramLocale,
  input: { orderId: string; status: string; boxes: number; total: number },
): string {
  const total = formatGap(input.total, 'turnover', locale);
  return truncateTelegramText(
    locale === 'ru'
      ? `Заказ ${input.orderId}: статус — ${input.status}.\n${input.boxes} коробок, ${total}. Детали доступны в портале.`
      : `Buyurtma ${input.orderId}: holat — ${input.status}.\n${input.boxes} quti, ${total}. Tafsilotlar portalda.`,
  );
}

export function buildOpportunityMessage(locale: TelegramLocale, input: { companyName: string; headline: string; action: string }): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Высокий приоритет · ${input.companyName}\n${input.headline}\n${input.action}`
      : `Yuqori ustuvorlik · ${input.companyName}\n${input.headline}\n${input.action}`,
  );
}

export function buildWelcomeMessage(locale: TelegramLocale, linked: boolean): string {
  if (!linked) {
    return truncateTelegramText(
      locale === 'ru'
        ? 'Здравствуйте! Это бот напоминаний Baraka B2B.\nЧтобы связать Telegram с учётной записью портала, получите одноразовый код в портале (Компания → Telegram) и отправьте: /start КОД\nКоманды: /help — помощь, /stop — отписаться.'
        : 'Assalomu alaykum! Bu Baraka B2B eslatmalar boti.\nTelegram’ni portal hisobi bilan bog‘lash uchun portalda bir martalik kod oling (Kompaniya → Telegram) va yuboring: /start KOD\nBuyruqlar: /help — yordam, /stop — obunani to‘xtatish.',
    );
  }
  return truncateTelegramText(
    locale === 'ru'
      ? 'Напоминания включены.\nВы будете получать: пятничное приветствие, остаток до следующего уровня, изменения статусов заказов. /stop — отписаться, /help — помощь.'
      : 'Eslatmalar yoqildi.\nSizga quyidagilar yuboriladi: juma tabrigi, keyingi darajagacha qolgan miqdor, buyurtma holatining o‘zgarishlari. /stop — obunani to‘xtatish, /help — yordam.',
  );
}

export function buildLinkSuccessMessage(locale: TelegramLocale): string {
  return buildWelcomeMessage(locale, true);
}

export function buildInvalidCodeMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Код недействителен или срок его действия истёк.\nПолучите новый одноразовый код в портале и отправьте: /start КОД'
      : 'Kod yaroqsiz yoki muddati tugagan.\nPortaldan yangi bir martalik kod oling va yuboring: /start KOD',
  );
}

export function buildHelpMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Baraka B2B — напоминания.\n/start КОД — связать аккаунт\n/start — включить напоминания\n/stop — выключить напоминания\n/help — это сообщение\nКлиенты получают пятничное приветствие, остаток до следующего уровня скидки и изменения статусов своих заказов. Менеджеры получают только срочные возможности по своим клиентам.'
      : 'Baraka B2B — eslatmalar.\n/start KOD — hisobni bog‘lash\n/start — eslatmalarni yoqish\n/stop — eslatmalarni o‘chirish\n/help — ushbu yordam\nMijozlar juma tabrigi, keyingi chegirma darajasigacha qolgan miqdor va o‘z buyurtmalarining holat o‘zgarishlarini oladi. Menejerlar faqat o‘z mijozlari bo‘yicha shoshilinch imkoniyatlarni oladi.',
  );
}

export function buildStopMessage(locale: TelegramLocale, hadSubscription: boolean): string {
  if (!hadSubscription) {
    return truncateTelegramText(
      locale === 'ru' ? 'У вас нет активной подписки. Чтобы включить напоминания, отправьте /start.' : 'Sizda faol obuna yo‘q. Eslatmalarni yoqish uchun /start yuboring.',
    );
  }
  return truncateTelegramText(
    locale === 'ru'
      ? 'Напоминания выключены. Вы больше не будете получать сообщения.\nЧтобы включить снова, отправьте /start.'
      : 'Eslatmalar o‘chirildi. Endi sizga xabar yuborilmaydi.\nQayta yoqish uchun /start yuboring.',
  );
}

export function buildUnknownCommandMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru' ? 'Неизвестная команда. Доступные команды: /start, /help, /stop.' : 'Noma’lum buyruq. Mavjud buyruqlar: /start, /help, /stop.',
  );
}

export function buildServiceUnavailableMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Сервис напоминаний временно недоступен. Попробуйте позже.'
      : 'Eslatmalar xizmati vaqtincha ishlamayapti. Birozdan so‘ng urinib ko‘ring.',
  );
}

/** One-time keyboard with a phone-share button (private chats only). */
export function buildSharePhoneKeyboard(locale: TelegramLocale): TelegramReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: locale === 'ru' ? '📱 Поделиться номером' : '📱 Telefon raqamni ulashish', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export const REMOVE_KEYBOARD: TelegramReplyKeyboardRemove = { remove_keyboard: true };

export function buildAskPhoneMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Добро пожаловать в Baraka B2B!\nЧтобы найти вашу компанию в базе, поделитесь номером телефона — нажмите кнопку ниже.'
      : 'Baraka B2B botiga xush kelibsiz!\nKompaniyangizni bazadan topish uchun telefon raqamingizni ulashing — pastdagi tugmani bosing.',
  );
}

export function buildContactInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Пожалуйста, поделитесь именно вашим номером через кнопку ниже — чужой номер принять нельзя.'
      : 'Iltimos, aynan o‘zingizning raqamingizni pastdagi tugma orqali ulashing — o‘zganing raqamini qabul qilib bo‘lmaydi.',
  );
}

export function buildClientFoundMessage(locale: TelegramLocale, input: { name: string; phone: string; code?: string }): string {
  const codeLine = input.code ? (locale === 'ru' ? `\nКод: ${input.code}` : `\nKod: ${input.code}`) : '';
  return truncateTelegramText(
    locale === 'ru'
      ? `С возвращением, ${input.name}!\nКомпания найдена в базе: ${input.name}\nТелефон: ${input.phone}${codeLine}\nНапоминания будут приходить в этот чат. /stop — отписаться, /help — помощь.`
      : `Xush kelibsiz, ${input.name}!\nKompaniyangiz bazadan topildi: ${input.name}\nTelefon: ${input.phone}${codeLine}\nEslatmalar shu chatga keladi. /stop — obunani to‘xtatish, /help — yordam.`,
  );
}

export function buildAskNameMessage(locale: TelegramLocale, phone: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Номер ${phone} в базе клиентов не найден. Зарегистрирую вас.\nКак вас зовут (Ф.И.О.)?`
      : `Raqam (${phone}) mijozlar bazasida topilmadi. Sizni ro‘yxatdan o‘tkazaman.\nIsmingiz (F.I.Sh.)?`,
  );
}

export function buildAskCompanyMessage(locale: TelegramLocale, name: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Спасибо, ${name}!\nНапишите название магазина/компании:`
      : `Rahmat, ${name}!\nDo‘kon/kompaniya nomini yozing:`,
  );
}

export function buildNameInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru' ? 'Имя слишком короткое. Напишите, пожалуйста, Ф.И.О. полностью.' : 'Ism juda qisqa. Iltimos, F.I.Sh. ni to‘liq yozing.',
  );
}

export function buildCompanyInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru' ? 'Название слишком короткое. Напишите название магазина/компании.' : 'Nom juda qisqa. Do‘kon/kompaniya nomini yozing.',
  );
}

export function buildRegisteredMessage(locale: TelegramLocale, input: { company: string; phone: string }): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Готово! Вы зарегистрированы: ${input.company} (${input.phone}).\nНапоминания будут приходить в этот чат. /stop — отписаться, /help — помощь.`
      : `Tayyor! Siz ro‘yxatga olindingiz: ${input.company} (${input.phone}).\nEslatmalar shu chatga keladi. /stop — obunani to‘xtatish, /help — yordam.`,
  );
}

export function buildAmbiguousClientMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'По этому номеру найдено несколько записей. Свяжитесь с вашим менеджером — он привяжет нужный аккаунт.'
      : 'Bu raqam bo‘yicha bir nechta yozuv topildi. Menejeringiz bilan bog‘laning — u kerakli hisobni bog‘lab beradi.',
  );
}

export function buildPilotAskPhoneMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Ассалому алейкум! Это бот напоминаний Baraka B2B 🧪 (сейчас работает в тестовом режиме).\n\nЧтобы начать, поделитесь номером телефона — нажмите кнопку ниже.'
      : 'Assalomu alaykum! Bu Baraka B2B eslatmalar boti 🧪 (hozir test rejimida ishlamoqda).\n\nBoshlash uchun telefon raqamingizni ulashing — pastdagi tugmani bosing.',
  );
}

export function buildPilotRegisteredMessage(locale: TelegramLocale, phone: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Спасибо! Номер принят: ${phone} ✅\n\n🧪 Тестовый режим: сейчас бот проверяет получение номера. Когда подключатся данные вашей компании, уровень, скидки и напоминания о заказах будут приходить в этот чат.\n\n/help — помощь, /stop — отписаться.`
      : `Rahmat! Raqamingiz qabul qilindi: ${phone} ✅\n\n🧪 Test rejimi: hozircha bot raqam qabul qilishni sinamoqda. Kompaniya maʼlumotlaringiz ulangach, darajangiz, chegirmalaringiz va buyurtma eslatmalari shu chatga keladi.\n\n/help — yordam, /stop — obunani to‘xtatish.`,
  );
}

export function buildPilotStatusMessage(locale: TelegramLocale, phone: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Вы зарегистрированы ✅\nНомер: ${phone}\n🧪 Тестовый режим продолжается. /stop — отписаться, /help — помощь.`
      : `Siz ro‘yxatdasiz ✅\nRaqam: ${phone}\n🧪 Test rejimi davom etmoqda. /stop — obunani to‘xtatish, /help — yordam.`,
  );
}

export function buildSkipLocationLabel(locale: TelegramLocale): string {
  return locale === 'ru' ? '⏭ Пропустить' : '⏭ O‘tkazib yuborish';
}

/** Keyboard with a location-share button plus a skip button. */
export function buildShareLocationKeyboard(locale: TelegramLocale): TelegramReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: locale === 'ru' ? '📍 Отправить локацию' : '📍 Lokatsiyani yuborish', request_location: true }],
      [{ text: buildSkipLocationLabel(locale) }],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function buildPilotAskNameMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru' ? 'Номер принят ✅\nКак вас зовут (Ф.И.О.)?' : 'Raqam qabul qilindi ✅\nIsmingiz (F.I.Sh.)?',
  );
}

export function buildPilotAskCompanyMessage(locale: TelegramLocale, name: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Спасибо, ${name}!\nНапишите название магазина/компании:`
      : `Rahmat, ${name}!\nDo‘kon/kompaniya nomini yozing:`,
  );
}

export function buildAskAddressMessage(locale: TelegramLocale, company: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Принято: ${company}.\nНапишите адрес магазина (город, улица, дом):`
      : `Qabul qilindi: ${company}.\nDo‘kon manzilini yozing (shahar, ko‘cha, bino):`,
  );
}

export function buildAddressInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Адрес слишком короткий. Напишите, пожалуйста, полный адрес магазина.'
      : 'Manzil juda qisqa. Iltimos, do‘kon manzilini to‘liq yozing.',
  );
}

export function buildAskLocationMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    locale === 'ru'
      ? 'Почти готово! Отправьте локацию магазина кнопкой ниже или пропустите этот шаг.'
      : 'Sal qoldi! Do‘kon lokatsiyasini pastdagi tugma bilan yuboring yoki bu qadamni o‘tkazib yuboring.',
  );
}

export function buildApplicationSubmittedMessage(locale: TelegramLocale, company: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Заявка принята ✅\nКомпания: ${company}\n\n🧪 Тестовый режим: администратор проверит заявку и вы получите уведомление в этот чат.`
      : `Arizangiz qabul qilindi ✅\nKompaniya: ${company}\n\n🧪 Test rejimi: administrator arizani tekshirib chiqadi, natija shu chatga keladi.`,
  );
}

export function buildApplicationPendingMessage(locale: TelegramLocale, company: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Ваша заявка на рассмотрении ⏳\nКомпания: ${company}\nАдминистратор скоро ответит — уведомление придёт в этот чат.`
      : `Arizangiz ko‘rib chiqilmoqda ⏳\nKompaniya: ${company}\nAdministrator tez orada javob beradi — xabar shu chatga keladi.`,
  );
}

export function buildApplicationApprovedMessage(locale: TelegramLocale, company: string): string {
  return truncateTelegramText(
    locale === 'ru'
      ? `Поздравляем! Ваша заявка одобрена ✅\nКомпания: ${company}\n\nТеперь напоминания об уровне, скидках и заказах будут приходить в этот чат. /stop — отписаться, /help — помощь.`
      : `Tabriklaymiz! Arizangiz tasdiqlandi ✅\nKompaniya: ${company}\n\nEndi daraja, chegirmalar va buyurtmalar haqidagi eslatmalar shu chatga keladi. /stop — obunani to‘xtatish, /help — yordam.`,
  );
}

export function buildApplicationRejectedMessage(locale: TelegramLocale, reason?: string): string {
  const reasonLine = reason ? (locale === 'ru' ? `\nПричина: ${reason}` : `\nSabab: ${reason}`) : '';
  return truncateTelegramText(
    locale === 'ru'
      ? `К сожалению, ваша заявка отклонена.${reasonLine}\nЧтобы подать заявку заново, нажмите /start.`
      : `Afsuski, arizangiz rad etildi.${reasonLine}\nQayta topshirish uchun /start bosing.`,
  );
}

export function buildAdminNewApplicationMessage(
  input: { chatId: number; phone: string; name: string; company: string; address: string; location?: { latitude: number; longitude: number } },
): string {
  const locationLine = input.location
    ? `\nLokatsiya: ${input.location.latitude}, ${input.location.longitude}\nhttps://maps.google.com/?q=${input.location.latitude},${input.location.longitude}`
    : '\nLokatsiya: yuborilmadi';
  return truncateTelegramText(
    `🆕 Yangi ariza!\n\nDo‘kon: ${input.company}\nMas’ul: ${input.name}\nTelefon: ${input.phone}\nManzil: ${input.address}${locationLine}\n\nAdmin panelda tasdiqlang: /admin/telegram`,
  );
}
