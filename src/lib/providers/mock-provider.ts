import { customers, orders, products } from '@/lib/domain/mock-data';
import { DEFAULT_LOYALTY_CONFIG } from '@/lib/domain/loyalty';
import type { LoyaltyConfig } from '@/lib/domain/types';
import type { LoyaltySettingsStore, MoySkladProvider } from './contracts';

export const mockMoySkladProvider: MoySkladProvider = {
  mode: 'mock',
  async getProducts() { return products; },
  async getProduct(id) { return products.find((product) => product.id === id) ?? null; },
  async getCustomers() { return customers; },
  async getCustomer(id) { return customers.find((customer) => customer.id === id) ?? null; },
  async getOrders(customerId) { return customerId ? orders.filter((order) => order.customerId === customerId) : orders; },
  async getOrder(id) { return orders.find((order) => order.id === id) ?? null; },
  async getCustomerPurchaseHistory(customerId) { return orders.filter((order) => order.customerId === customerId); },
};

let demoConfig = DEFAULT_LOYALTY_CONFIG;
export const mockLoyaltySettingsStore: LoyaltySettingsStore = {
  async getConfig() { return demoConfig; },
  async saveConfig(config: LoyaltyConfig) { demoConfig = config; },
};
