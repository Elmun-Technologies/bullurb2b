import type { Customer, Product, SalesOrder } from './types';
import { DEFAULT_TIERS, getTierForValue } from './loyalty';

const companyNames = ['SAMARQAND MARKET', 'BARAKA SAVDO', 'ORIENT RETAIL', 'FAMILY MARKET', 'ZARAFSHON TRADE', 'NAVOI DISTRIBUTION', 'TOSHKENT FOOD SERVICE', 'ASIA GROSS', 'MEGA SAVDO', 'BUNYODKOR MARKET', 'FAYZ BIZNES', 'OLTIN VODIY', 'ANDIJON SAVDO', 'MARVARID RETAIL', 'KARVON DISTRIBUTION', 'NAMANGAN BARAKA', 'REGISTON FOODS', 'QIBRAY TRADE', 'YANGI BOZOR', 'BIZNES HAMKOR'];
const regions = ['Toshkent shahri', 'Samarqand', 'Buxoro', 'Farg‘ona', 'Andijon', 'Navoiy', 'Namangan', 'Qashqadaryo'];
const boxes = [82, 46, 136, 28, 194, 63, 245, 18, 98, 342, 53, 12, 76, 119, 201, 41, 488, 91, 25, 158];
const turnover = [18_600_000, 9_200_000, 31_400_000, 5_500_000, 44_200_000, 12_700_000, 53_000_000, 3_200_000, 23_300_000, 87_000_000, 11_800_000, 2_100_000, 16_400_000, 28_900_000, 49_000_000, 8_100_000, 122_000_000, 19_200_000, 4_800_000, 36_700_000];
const turnoverTierThresholds = [0, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
const turnoverTiers = DEFAULT_TIERS.map((tier, index) => ({ ...tier, minValue: turnoverTierThresholds[index] ?? tier.minValue }));

export const customers: Customer[] = companyNames.map((name, index) => ({
  id: `company-${String(index + 1).padStart(3, '0')}`,
  name,
  region: regions[index % regions.length],
  contactName: ['Dilshod Karimov', 'Madina Usmonova', 'Jasur Rahimov', 'Shahnoza Aliyeva'][index % 4],
  email: `hamkor${index + 1}@example.uz`,
  phone: `+998 9${index % 2 ? '0' : '3'} ${String(120 + index * 7).padStart(3, '0')} ${String(14 + index).padStart(2, '0')} ${String(20 + index).padStart(2, '0')}`,
  currentBoxes: boxes[index],
  currentTurnover: turnover[index],
  tierId: getTierForValue(Math.round(boxes[index] * ([0.7, 1.8, 0.8, 1.6][index % 4])), DEFAULT_TIERS).id,
  tierIdByMetric: { boxes: getTierForValue(Math.round(boxes[index] * ([0.7, 1.8, 0.8, 1.6][index % 4])), DEFAULT_TIERS).id, turnover: getTierForValue(Math.round(turnover[index] * ([0.75, 1.2, 0.8, 1.7][index % 4])), turnoverTiers).id },
  metricsByPeriod: {
    'calendar-month': { boxes: boxes[index], turnover: turnover[index] },
    'last-30-days': { boxes: boxes[index] + Math.round(boxes[index] * 0.52), turnover: Math.round(turnover[index] * 1.58) },
    'last-90-days': { boxes: boxes[index] + Math.round(boxes[index] * 1.9), turnover: Math.round(turnover[index] * 2.85) },
  },
  previousBoxes: Math.round(boxes[index] * ([0.7, 1.8, 0.8, 1.6][index % 4])),
  previousTurnover: Math.round(turnover[index] * ([0.75, 1.2, 0.8, 1.7][index % 4])),
  lastPurchase: index === 7 || index === 11 ? '2026-07-22' : `2026-09-${String(27 - (index % 20)).padStart(2, '0')}`,
  manager: ['Azizbek Tursunov', 'Malika Qodirova', 'Sardor Ismoilov'][index % 3],
  active: index !== 7 && index !== 11,
}));

const catalog = [
  ['Sut 3.2%', 'SUT', 'Sut mahsulotlari', 'Oqtepa', 128000, 246, 'milk'],
  ['Qatiq an’anaviy', 'QAT', 'Sut mahsulotlari', 'Oqtepa', 96000, 184, 'dairy'],
  ['Sariyog‘ 82.5%', 'SAR', 'Sut mahsulotlari', 'Baraka', 215000, 82, 'butter'],
  ['Pishloq klassik', 'PIS', 'Sut mahsulotlari', 'Oqtepa', 189000, 64, 'cheese'],
  ['Yogurt qulupnay', 'YOG', 'Sut mahsulotlari', 'Baraka', 84000, 132, 'yogurt'],
  ['Mineral suv 1.5L', 'SUV', 'Ichimliklar', 'Zilol', 42000, 520, 'water'],
  ['Sharbat olma 1L', 'SHA', 'Ichimliklar', 'Meva', 68000, 206, 'juice'],
  ['Ko‘k choy 100g', 'CHO', 'Choy va qahva', 'Samarqand Tea', 54000, 116, 'tea'],
  ['Qora choy 250g', 'QCH', 'Choy va qahva', 'Samarqand Tea', 99000, 78, 'tea'],
  ['Qahva klassik 200g', 'QAH', 'Choy va qahva', 'Rohat', 172000, 42, 'coffee'],
  ['Guruch lazer 5kg', 'GUR', 'Oziq-ovqat', 'Zarafshon', 146000, 192, 'rice'],
  ['Un oliy nav 5kg', 'UN', 'Oziq-ovqat', 'Baraka', 38000, 310, 'flour'],
  ['Shakar 5kg', 'SHAK', 'Oziq-ovqat', 'Oq oltin', 72000, 146, 'sugar'],
  ['Makaron spagetti', 'MAK', 'Oziq-ovqat', 'Dono', 46000, 226, 'pasta'],
  ['O‘simlik yog‘i 1L', 'YOQ', 'Oziq-ovqat', 'Baraka', 175000, 0, 'oil'],
  ['Konserva no‘xat', 'KON', 'Konservalar', 'Mehr', 69000, 94, 'can'],
  ['Tomat pastasi', 'TOM', 'Konservalar', 'Mehr', 58000, 138, 'tomato'],
  ['Bodom 250g', 'BOD', 'Yong‘oq va quruq meva', 'Samarqand', 132000, 24, 'nuts'],
  ['Mayiz 500g', 'MAY', 'Yong‘oq va quruq meva', 'Samarqand', 87000, 76, 'nuts'],
  ['Asal tog‘ asali 450g', 'ASA', 'Shirinliklar', 'Zarafshon', 198000, 31, 'honey'],
  ['Pechenye saryog‘li', 'PEC', 'Shirinliklar', 'Rohat', 76000, 168, 'cookie'],
  ['Shokolad qora 100g', 'SHO', 'Shirinliklar', 'Rohat', 92000, 118, 'chocolate'],
  ['Vafli kremli', 'VAF', 'Shirinliklar', 'Dono', 61000, 95, 'wafer'],
  ['Bolalar bo‘tqasi', 'BOT', 'Bolalar oziq-ovqati', 'Mehr', 124000, 54, 'baby'],
  ['Salfetka yumshoq', 'SAL', 'Uy-ro‘zg‘or', 'Toza', 34000, 382, 'home'],
  ['Idish yuvish geli', 'GEL', 'Uy-ro‘zg‘or', 'Toza', 63000, 89, 'home'],
  ['Kir yuvish kukuni', 'KIR', 'Uy-ro‘zg‘or', 'Toza', 154000, 62, 'home'],
  ['Qog‘oz sochiq', 'QOG', 'Uy-ro‘zg‘or', 'Toza', 48000, 174, 'home'],
  ['Mineral suv 0.5L', 'SU5', 'Ichimliklar', 'Zilol', 28000, 402, 'water'],
  ['Gazli ichimlik limon', 'GAZ', 'Ichimliklar', 'Meva', 51000, 146, 'juice'],
  ['Yogurt tabiiy', 'YOT', 'Sut mahsulotlari', 'Baraka', 79000, 0, 'yogurt'],
  ['Qaymoq 20%', 'QAY', 'Sut mahsulotlari', 'Oqtepa', 116000, 78, 'dairy'],
  ['Loviya qizil 1kg', 'LOV', 'Oziq-ovqat', 'Zarafshon', 66000, 88, 'rice'],
  ['Makkajo‘xori konserva', 'MKS', 'Konservalar', 'Mehr', 74000, 48, 'can'],
  ['Murabbo o‘rik', 'MUR', 'Shirinliklar', 'Samarqand', 98000, 57, 'honey'],
  ['Kunjutli pechenye', 'KUN', 'Shirinliklar', 'Rohat', 67000, 138, 'cookie'],
  ['Qora murch 100g', 'MURC', 'Ziravorlar', 'Dono', 45000, 24, 'spice'],
  ['Zira 100g', 'ZIR', 'Ziravorlar', 'Dono', 39000, 36, 'spice'],
  ['Sirka olma 0.5L', 'SIR', 'Oziq-ovqat', 'Baraka', 32000, 108, 'juice'],
  ['Yong‘oq mag‘zi 250g', 'YON', 'Yong‘oq va quruq meva', 'Samarqand', 164000, 19, 'nuts'],
] as const;

export const products: Product[] = catalog.map(([name, prefix, category, brand, price, stock, art], index) => ({
  id: `product-${String(index + 1).padStart(3, '0')}`,
  name,
  sku: `BR-${prefix}-${String(100 + index)}`,
  category,
  brand,
  unit: 'quti',
  packBoxes: index % 7 === 0 ? 6 : index % 4 === 0 ? 12 : 1,
  price,
  specialPrices: index === 0 ? { 'company-001': 121000 } : index === 8 ? { 'company-001': 91000 } : undefined,
  stock,
  minOrder: index % 6 === 0 ? 2 : 1,
  art,
  description: `${brand} brendining sifatli mahsuloti. Ulgurji buyurtma uchun tayyor.`,
}));

const statuses = ['Yetkazildi', 'Yetkazildi', 'Yetkazildi', 'Yo‘lda', 'Yig‘ilmoqda', 'Bekor qilindi'] as const;
export const orders: SalesOrder[] = Array.from({ length: 64 }, (_, index) => {
  const customer = customers[index === 0 ? 0 : (index * 7 + 3) % customers.length];
  const itemCount = 1 + (index % 4);
  const lines = Array.from({ length: itemCount }, (_, lineIndex) => {
    const product = products[(index * 3 + lineIndex * 11) % products.length];
    const quantity = 2 + ((index + lineIndex * 3) % 11);
    return { productId: product.id, quantity, unitPrice: Math.round(product.price * (customer.id === 'company-001' ? 0.97 : 1)) };
  });
  const date = index === 0 ? '2026-09-24' : `2026-09-${String(28 - (index % 27)).padStart(2, '0')}`;
  const boxesTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { id: `BR-2026-${String(1742 - index).padStart(4, '0')}`, customerId: customer.id, date, status: index === 0 ? 'Yetkazildi' : statuses[index % statuses.length], items: itemCount, boxes: boxesTotal, total: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), lines };
});

export const demoCustomer = customers[0];
export { DEFAULT_TIERS };
