import React, { lazy, Suspense, useMemo, useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';

const ChatAssistant = lazy(() => import('./ChatAssistant'));

const PAGE_NAMES: Record<string, string> = {
  '/': 'Team Calendar',
  '/my-calendar': 'My Calendar',
  '/profile': 'Profile',
  '/admin/users': 'Admin Users',
  '/admin/holidays': 'Admin Holidays',
  '/admin/events': 'Admin Events',
  '/admin/insights': 'Insights',
  '/admin/user-insights': 'User Insights',
};

const NAV_ICONS: Record<string, string> = {
  '/': '📅',
  '/my-calendar': '🗓️',
  '/profile': '👤',
  '/admin/users': '👥',
  '/admin/holidays': '🎉',
  '/admin/events': '📌',
  '/admin/insights': '📊',
  '/admin/user-insights': '👤',
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();
  const pageName = useMemo(() => PAGE_NAMES[location.pathname] ?? '', [location.pathname]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);

  const navLinks = [
    { to: '/', label: 'Team View' },
    { to: '/my-calendar', label: 'My Calendar' },
    ...(isAdmin
      ? [
          { to: '/admin/users', label: 'Users' },
          { to: '/admin/holidays', label: 'Holidays' },
          { to: '/admin/events', label: 'Events' },
          { to: '/admin/insights', label: 'Insights' },
          { to: '/admin/user-insights', label: 'Employee' },
        ]
      : []),
  ];

  const isActive = (path: string) => location.pathname === path;

  // Close drawer on navigation
  useEffect(() => {
    if (drawerOpen) closeDrawer();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => {
    setDrawerClosing(true);
    setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    }, 200);
  }, []);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    setDrawerClosing(false);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Left: Hamburger (mobile) + Logo */}
            <div className="flex items-center gap-2">
              {/* Hamburger menu button — only visible on mobile */}
              <button
                type="button"
                onClick={openDrawer}
                className="md:hidden flex items-center justify-center w-10 h-10 -ml-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Open navigation menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              <Link to="/" className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-xl sm:text-2xl">📍</span>
                <span className="font-bold text-lg sm:text-xl text-gray-900 dark:text-gray-100">dhSync</span>
              </Link>
            </div>

            {/* Center: Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(link.to)
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Right: User controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              <Link
                to="/profile"
                className="hidden sm:inline-flex items-center text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
              >
                {user?.name}
                {isAdmin && (
                  <span className="ml-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                    Admin
                  </span>
                )}
              </Link>
              <button
                onClick={logout}
                className="hidden sm:block text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {drawerOpen && (
        <>
          {/* Overlay */}
          <div
            className={`nav-drawer-overlay ${drawerClosing ? 'nav-drawer-overlay-closing' : ''}`}
            onClick={closeDrawer}
            aria-hidden
          />

          {/* Drawer */}
          <div className={`nav-drawer ${drawerClosing ? 'nav-drawer-closing' : ''}`}>
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-xl">📍</span>
                <span className="font-bold text-lg text-gray-900 dark:text-gray-100">dhSync</span>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="flex items-center justify-center w-10 h-10 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Close navigation menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* User info */}
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-primary-700 dark:text-primary-300 text-sm font-bold">
                  {user?.name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user?.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                </div>
                {isAdmin && (
                  <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full shrink-0">
                    Admin
                  </span>
                )}
              </div>
            </div>

            {/* Navigation links */}
            <nav className="flex-1 overflow-y-auto py-2 px-2">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors mb-0.5 ${
                    isActive(link.to)
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="text-base w-6 text-center">{NAV_ICONS[link.to] || '📄'}</span>
                  {link.label}
                  {isActive(link.to) && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />
                  )}
                </Link>
              ))}
            </nav>

            {/* Drawer footer */}
            <div className="border-t border-gray-200 dark:border-gray-700 p-3 space-y-1">
              <Link
                to="/profile"
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="text-base w-6 text-center">⚙️</span>
                Profile & Settings
              </Link>
              <button
                onClick={() => { closeDrawer(); logout(); }}
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <span className="text-base w-6 text-center">🚪</span>
                Logout
              </button>
            </div>
          </div>
        </>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
        {children}
      </main>

      {/* Chat Assistant (lazy-loaded) */}
      <Suspense fallback={null}>
        <ChatAssistant pageName={pageName} />
      </Suspense>
    </div>
  );
};

export default Layout;
