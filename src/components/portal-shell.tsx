'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Building2, ChevronDown, CircleHelp, Command, FileText, LayoutDashboard, LifeBuoy, LogOut, Menu, PackageSearch, Send, Settings2, ShoppingBag, Sparkles, Tags, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { usePortal } from './portal-context';
import { getPortalNotifications } from '@/lib/domain/notifications';
import { uz } from '@/messages/uz';

const clientLinks = [
  { href: '/dashboard', label: uz.dashboard, icon: LayoutDashboard },
  { href: '/catalog', label: uz.catalog, icon: PackageSearch },
  { href: '/prices', label: uz.prices, icon: Tags },
  { href: '/orders', label: uz.orders, icon: FileText },
  { href: '/loyalty', label: uz.loyalty, icon: Sparkles },
  { href: '/company', label: uz.company, icon: Building2 },
];
const adminLinks = [
  { href: '/admin', label: 'Umumiy ko‘rinish', icon: LayoutDashboard },
  { href: '/admin/clients', label: 'Mijozlar', icon: Users },
  { href: '/admin/opportunities', label: 'Savdo imkoniyatlari', icon: Sparkles },
  { href: '/admin/loyalty', label: 'Loyallik sozlamalari', icon: Settings2 },
  { href: '/admin/telegram', label: 'Telegram arizalar', icon: Send },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { role, setRole, cart, config, allCustomers, allOrders } = usePortal();
  const onAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  // The URL wins: /admin always shows admin nav (the demo switcher never grants access — middleware does).
  const isAdmin = onAdminRoute || role !== 'CLIENT';
  const isLoginRoute = pathname === '/admin/login';

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };
  const links = useMemo(() => isAdmin ? adminLinks : clientLinks, [isAdmin]);
  const pageTitle = pathname.startsWith('/admin/clients') ? 'Mijozlar' : pathname.startsWith('/admin/opportunities') ? 'Savdo imkoniyatlari' : pathname.startsWith('/admin/loyalty') ? 'Loyallik sozlamalari' : pathname.startsWith('/admin/telegram') ? 'Telegram arizalar' : pathname.startsWith('/admin') ? 'Umumiy ko‘rinish' : clientLinks.find((link) => link.href === pathname)?.label ?? 'Buyurtma';
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const notifications = useMemo(() => allCustomers[0] ? getPortalNotifications({ role, customer: allCustomers[0], customers: allCustomers, orders: allOrders, config }) : [], [role, allCustomers, allOrders, config]);

  const navContent = <>
    <Link href="/dashboard" className="brand-lockup" onClick={() => setOpen(false)}>
      <span className="brand-mark"><Command size={21} strokeWidth={2.4} /></span>
      <span className="brand-copy"><strong>baraka</strong><small>B2B hamkorlar portali</small></span>
    </Link>
    <div className="workspace-label">ISH JOYI</div>
    <div className="workspace-select"><span className="workspace-avatar">S</span><span><b>Samarqand Market</b><small>Premium hamkor</small></span><ChevronDown size={15} /></div>
    <div className="nav-label">ASOSIY</div>
    <nav className="side-nav" aria-label="Asosiy navigatsiya">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/admin' ? pathname === href : pathname === href || (href !== '/dashboard' && href !== '/catalog' && href !== '/orders' && pathname.startsWith(`${href}/`));
        return <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-link ${active ? 'active' : ''}`}><Icon size={18} strokeWidth={1.9} /><span>{label}</span>{href === '/catalog' && cartCount > 0 ? <em className="nav-count">{cartCount}</em> : null}</Link>;
      })}
    </nav>
    <div className="sidebar-spacer" />
    <div className="sidebar-promo"><div className="promo-icon"><Sparkles size={16} /></div><strong>Keyingi bosqichga yaqin!</strong><p>Har bir buyurtma sizga yanada yaxshi narx olib keladi.</p><Link href={isAdmin ? '/admin/opportunities' : '/loyalty'}>Batafsil <span>↗</span></Link></div>
    <div className="sidebar-help"><CircleHelp size={17} /><span>Yordam markazi</span><LifeBuoy size={16} className="help-right" /></div>
    <div className="profile-row"><div className="profile-avatar">{isAdmin ? 'AT' : 'SK'}</div><span className="profile-name"><b>{isAdmin ? 'Azizbek Tursunov' : 'Samarqand Market'}</b><small>{isAdmin ? 'Savdo menejeri' : 'Hamkor hisobi'}</small></span><button aria-label="Profil sozlamalari" className="icon-button profile-more"><ChevronDown size={16} /></button></div>
  </>;

  if (isLoginRoute) {
    return <div className="portal-frame login-frame"><main className="page-content">{children}</main></div>;
  }

  return <div className="portal-frame">
    <aside className="desktop-sidebar">{navContent}</aside>
    {open ? <div className="mobile-overlay" onClick={() => setOpen(false)}><aside className="mobile-sidebar" onClick={(event) => event.stopPropagation()}><button className="mobile-close icon-button" onClick={() => setOpen(false)} aria-label="Menyuni yopish"><X size={19} /></button>{navContent}</aside></div> : null}
    <div className="portal-main">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Menyuni ochish" onClick={() => setOpen(true)}><Menu size={20} /></button>
        <div className="breadcrumbs"><span>Baraka</span><span className="crumb-sep">/</span><strong>{pageTitle}</strong></div>
        <div className="topbar-actions">
          {onAdminRoute
            ? <><span className="admin-badge">Administrator</span><button className="button ghost small" onClick={logout}><LogOut size={15} /> Chiqish</button></>
            : <div className="demo-select-wrap"><span className="demo-dot" /><select aria-label="Demo ko‘rinishi" value={role} onChange={(event) => setRole(event.target.value as 'CLIENT' | 'ADMIN' | 'SALES_MANAGER')}><option value="CLIENT">Mijoz ko‘rinishi</option><option value="SALES_MANAGER">Menejer ko‘rinishi</option><option value="ADMIN">Admin ko‘rinishi</option></select><ChevronDown size={13} /></div>}
          <Link href="/orders/new" aria-label={`Savat, ${cartCount} ta mahsulot`} className="top-icon-button cart-shortcut"><ShoppingBag size={18} />{cartCount > 0 ? <i>{cartCount}</i> : null}</Link>
          <button className="top-icon-button notification-button" aria-label={`Eslatmalar, ${notifications.length} ta`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}><Bell size={18} />{notifications.length > 0 ? <i>{notifications.length > 9 ? '9+' : notifications.length}</i> : null}</button>
          {notificationsOpen ? <section className="notification-popover" aria-label="Eslatmalar markazi"><div className="notification-popover-head"><span><strong>{uz.reminders.title}</strong><small>{notifications.length ? uz.reminders.count(notifications.length) : uz.reminders.none}</small></span><button className="icon-button" aria-label="Eslatmalarni yopish" onClick={() => setNotificationsOpen(false)}><X size={15} /></button></div>{notifications.length ? <div className="notification-list">{notifications.map((item) => <Link href={item.href} key={item.id} className="notification-item" onClick={() => setNotificationsOpen(false)}><span className={`notification-kind ${item.kind.toLowerCase().replaceAll('_', '-')}`}><Sparkles size={15} /></span><span><b>{item.title}</b><small>{item.message}</small></span><ChevronDown size={14} className="notification-arrow" /></Link>)}</div> : <p className="notification-empty">{uz.reminders.empty}</p>}<div className="notification-foot">{uz.reminders.footer}</div></section> : null}
          <div className="top-avatar">SK</div>
        </div>
      </header>
      <main className="page-content">{children}</main>
      <footer className="portal-footer"><span>© 2026 Baraka B2B Portal</span>{onAdminRoute ? <span><span className="live-dot live" /> Jonli ma’lumotlar</span> : <span><span className="live-dot" /> Demo ma’lumotlar · integratsiya ulanmagan</span>}</footer>
    </div>
  </div>;
}
