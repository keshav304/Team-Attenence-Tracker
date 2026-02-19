import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();

  const navLinks = [
    { to: '/', label: 'Team View' },
    { to: '/my-calendar', label: 'My Calendar' },
    ...(isAdmin
      ? [
          { to: '/admin/users', label: 'Users' },
          { to: '/admin/holidays', label: 'Holidays' },
          { to: '/admin/insights', label: 'Insights' },
        ]
      : []),
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <span className="text-2xl">📍</span>
              <span className="font-bold text-xl text-gray-900">A-Team Tracker</span>
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(link.to)
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* User Menu */}
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                {user?.name}
                {isAdmin && (
                  <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                    Admin
                  </span>
                )}
              </Link>
              <button
                onClick={logout}
                className="text-sm text-gray-500 hover:text-red-600 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden border-t border-gray-100">
          <div className="flex overflow-x-auto px-4 py-2 gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium ${
                  isActive(link.to)
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
};

export default Layout;
