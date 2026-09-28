export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(new Date(value));
}
