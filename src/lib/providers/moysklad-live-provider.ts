import 'server-only';
import type { MoySkladProvider } from './contracts';
import { IntegrationError } from './errors';

/**
 * Intentionally not implemented: this checkout contains no MoySklad API documentation,
 * token, Shopflow proxy contract, or verified status/price mapping. Do not guess endpoints.
 * Replace this with a server-side adapter after inspecting the actual account/API contract.
 */
const unconfigured = () => new IntegrationError('UNCONFIGURED', 'MoySklad live adapter has no verified API contract.');

export const unconfiguredMoySkladProvider: MoySkladProvider = {
  mode: 'live',
  async getProducts() { throw unconfigured(); },
  async getProduct() { throw unconfigured(); },
  async getCustomers() { throw unconfigured(); },
  async getCustomer() { throw unconfigured(); },
  async getOrders() { throw unconfigured(); },
  async getOrder() { throw unconfigured(); },
  async getCustomerPurchaseHistory() { throw unconfigured(); },
};
