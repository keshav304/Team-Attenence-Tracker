import axios, { AxiosError } from 'axios';

interface ServerAxiosError extends AxiosError {
  serverMessage?: string;
  serverCode?: string;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally + normalise error messages
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ success: boolean; message?: string; code?: string }>) => {
    const status = error.response?.status;
    const data = error.response?.data;

    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Only redirect if not already on login/register pages
      const pathname = window.location.pathname;
      if (
        pathname !== '/login' && !pathname.startsWith('/login/') &&
        pathname !== '/register' && !pathname.startsWith('/register/')
      ) {
        window.location.href = '/login';
      }
    }

    // Attach a human-readable message to the error so callers can use it
    if (data?.message) {
      const serverError = error as ServerAxiosError;
      serverError.serverMessage = data.message;
      serverError.serverCode = data.code;
    }

    return Promise.reject(error);
  }
);

/**
 * Extract a user-friendly error message from an Axios error.
 * Prefer the server-provided message, fall back to generic text.
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const serverMsg = error.response?.data?.message;
    if (serverMsg && typeof serverMsg === 'string') return serverMsg;
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

export default api;
