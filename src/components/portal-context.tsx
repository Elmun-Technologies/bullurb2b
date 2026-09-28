'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { customers, orders as seededOrders, products } from '@/lib/domain/mock-data';
import { DEFAULT_LOYALTY_CONFIG, calculateLoyaltySummary, getCustomerMetricValue, isValidLoyaltyConfig } from '@/lib/domain/loyalty';
import { calculatePrice } from '@/lib/domain/pricing';
import type { LoyaltyConfig, Role, SalesOrder } from '@/lib/domain/types';

export interface CartLine { productId: string; quantity: number; }
interface PortalContextValue {
  cart: CartLine[];
  role: Role;
  setRole: (role: Role) => void;
  config: LoyaltyConfig;
  saveConfig: (config: LoyaltyConfig) => void;
  purchaseAddition: number;
  customerBoxes: number;
  customerTurnover: number;
  allOrders: SalesOrder[];
  allCustomers: typeof customers;
  addToCart: (productId: string, quantity?: number) => void;
  setCartQuantity: (productId: string, quantity: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  simulateFulfillment: () => SalesOrder;
}

const PortalContext = createContext<PortalContextValue | null>(null);
const CLIENT_KEY = 'baraka-demo-portal-v1';
type Persisted = { cart?: CartLine[]; role?: Role; purchaseAddition?: number; turnoverAddition?: number; demoOrders?: SalesOrder[]; config?: LoyaltyConfig };

export function PortalProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [role, setRole] = useState<Role>('CLIENT');
  const [purchaseAddition, setPurchaseAddition] = useState(0);
  const [turnoverAddition, setTurnoverAddition] = useState(0);
  const [demoOrders, setDemoOrders] = useState<SalesOrder[]>([]);
  const [config, setConfig] = useState<LoyaltyConfig>(DEFAULT_LOYALTY_CONFIG);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CLIENT_KEY);
      if (stored) {
        const value = JSON.parse(stored) as Persisted;
        if (Array.isArray(value.cart)) setCart(value.cart);
        if (value.role === 'ADMIN' || value.role === 'SALES_MANAGER' || value.role === 'CLIENT') setRole(value.role);
        if (typeof value.purchaseAddition === 'number') setPurchaseAddition(value.purchaseAddition);
        if (typeof value.turnoverAddition === 'number') setTurnoverAddition(value.turnoverAddition);
        if (Array.isArray(value.demoOrders)) setDemoOrders(value.demoOrders);
        if (isValidLoyaltyConfig(value.config)) setConfig(value.config);
      }
    } catch { localStorage.removeItem(CLIENT_KEY); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const value: Persisted = { cart, role, purchaseAddition, turnoverAddition, demoOrders, config };
    localStorage.setItem(CLIENT_KEY, JSON.stringify(value));
  }, [cart, role, purchaseAddition, turnoverAddition, demoOrders, config, hydrated]);

  const addToCart = (productId: string, quantity = 1) => setCart((current) => {
    const product = products.find((item) => item.id === productId);
    if (!product || product.stock <= 0) return current;
    const existing = current.find((line) => line.productId === productId);
    const requested = (existing?.quantity ?? 0) + Math.max(product.minOrder, quantity);
    const nextQuantity = Math.min(product.stock, requested);
    return existing ? current.map((line) => line.productId === productId ? { ...line, quantity: nextQuantity } : line) : [...current, { productId, quantity: nextQuantity }];
  });
  const setCartQuantity = (productId: string, quantity: number) => setCart((current) => {
    if (quantity <= 0) return current.filter((line) => line.productId !== productId);
    const product = products.find((item) => item.id === productId);
    const nextQuantity = product ? Math.min(product.stock, Math.max(product.minOrder, quantity)) : quantity;
    return current.map((line) => line.productId === productId ? { ...line, quantity: nextQuantity } : line);
  });
  const removeFromCart = (productId: string) => setCart((current) => current.filter((line) => line.productId !== productId));
  const clearCart = () => setCart([]);
  const saveConfig = (next: LoyaltyConfig) => setConfig(next);

  const simulateFulfillment = (): SalesOrder => {
    const lines = cart.map((line) => {
      const product = products.find((item) => item.id === line.productId)!;
      const loyaltyValue = getCustomerMetricValue(customers[0], config) + (config.metric === 'boxes' ? purchaseAddition : turnoverAddition);
      const summary = calculateLoyaltySummary(loyaltyValue, config);
      return { productId: line.productId, quantity: line.quantity, unitPrice: calculatePrice(product, summary, customers[0].id).finalPrice };
    });
    const order: SalesOrder = {
      id: `DEMO-${Date.now().toString().slice(-6)}`,
      customerId: customers[0].id,
      date: new Date().toISOString().slice(0, 10),
      status: 'Yetkazildi',
      items: lines.length,
      boxes: lines.reduce((sum, line) => sum + line.quantity, 0),
      total: lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
      lines,
    };
    setPurchaseAddition((value) => value + order.boxes);
    setTurnoverAddition((value) => value + order.total);
    setDemoOrders((value) => [order, ...value]);
    setCart([]);
    return order;
  };

  const liveDemoCustomer = {
    ...customers[0],
    currentBoxes: customers[0].currentBoxes + purchaseAddition,
    currentTurnover: customers[0].currentTurnover + turnoverAddition,
    metricsByPeriod: Object.fromEntries(Object.entries(customers[0].metricsByPeriod ?? {}).map(([period, metric]) => [period, { boxes: metric.boxes + purchaseAddition, turnover: metric.turnover + turnoverAddition }])),
    tierId: calculateLoyaltySummary(getCustomerMetricValue(customers[0], config) + (config.metric === 'boxes' ? purchaseAddition : turnoverAddition), config).currentTier.id,
    tierIdByMetric: { ...customers[0].tierIdByMetric, [config.metric]: calculateLoyaltySummary(getCustomerMetricValue(customers[0], config) + (config.metric === 'boxes' ? purchaseAddition : turnoverAddition), config).currentTier.id },
  };
  const allCustomers = [liveDemoCustomer, ...customers.slice(1)];
  const value: PortalContextValue = { cart, role, setRole, config, saveConfig, purchaseAddition, customerBoxes: (customers[0].metricsByPeriod?.[config.period]?.boxes ?? customers[0].currentBoxes) + purchaseAddition, customerTurnover: (customers[0].metricsByPeriod?.[config.period]?.turnover ?? customers[0].currentTurnover) + turnoverAddition, allOrders: [...demoOrders, ...seededOrders], allCustomers, addToCart, setCartQuantity, removeFromCart, clearCart, simulateFulfillment };
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): PortalContextValue {
  const context = useContext(PortalContext);
  if (!context) throw new Error('usePortal must be used inside PortalProvider');
  return context;
}
