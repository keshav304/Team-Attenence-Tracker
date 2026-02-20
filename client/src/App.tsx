import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import TeamCalendarPage from './pages/TeamCalendarPage';
import MyCalendarPage from './pages/MyCalendarPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminHolidaysPage from './pages/AdminHolidaysPage';
import InsightsPage from './pages/InsightsPage';
import UserInsightsPage from './pages/UserInsightsPage';
import ProfilePage from './pages/ProfilePage';

function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TeamCalendarPage />} />
        <Route path="/my-calendar" element={<MyCalendarPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        {user.role === 'admin' && (
          <>
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/holidays" element={<AdminHolidaysPage />} />
            <Route path="/admin/insights" element={<InsightsPage />} />
            <Route path="/admin/user-insights" element={<UserInsightsPage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
