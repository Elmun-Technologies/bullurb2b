import type { Customer, LoyaltyConfig, Product, SalesOrder } from '@/lib/domain/types';

export interface MoySkladProvider {
  readonly mode: 'mock' | 'live';
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  getCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
  getOrders(customerId?: string): Promise<SalesOrder[]>;
  getOrder(id: string): Promise<SalesOrder | null>;
  getCustomerPurchaseHistory(customerId: string): Promise<SalesOrder[]>;
}

export interface LoyaltySettingsStore {
  getConfig(): Promise<LoyaltyConfig>;
  saveConfig(config: LoyaltyConfig): Promise<void>;
}
