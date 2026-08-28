import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

import { API_BASE_URL } from '../services/apiBase';

// User type
export interface User {
  user_id: string;
  email: string;
  username: string;
  full_name: string | null;
  has_kobo_api_key: boolean;
  kobo_api_url: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  last_login_at: string | null;
}

// Auth context type
interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: { username?: string; full_name?: string; kobo_api_url?: string }) => Promise<void>;
  setKoboApiKey: (apiKey: string) => Promise<void>;
  deleteKoboApiKey: () => Promise<void>;
  testKoboApiKey: () => Promise<{ status: string; message: string; kobo_user?: { username: string; email: string; organization: string } }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Local storage keys
const TOKEN_KEY = 'field_compass_token';
const USER_KEY = 'field_compass_user';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);

  // Helper to make authenticated API requests
  const authFetch = async (endpoint: string, options: RequestInit = {}) => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      // Token expired or invalid
      logout();
      throw new Error('Session expired. Please login again.');
    }

    return response;
  };

  // Verify token and refresh user on mount
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await authFetch('/api/users/me');
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
          localStorage.setItem(USER_KEY, JSON.stringify(userData));
        } else {
          // Token invalid
          logout();
        }
      } catch (error) {
        console.error('Token verification failed:', error);
        logout();
      } finally {
        setIsLoading(false);
      }
    };

    verifyToken();
  }, []);

  const login = async (email: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', email); // OAuth2 expects 'username' field
    formData.append('password', password);

    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    const data = await response.json();
    const newToken = data.access_token;

    setToken(newToken);
    localStorage.setItem(TOKEN_KEY, newToken);

    // Fetch user profile
    const userResponse = await fetch(`${API_BASE_URL}/api/users/me`, {
      headers: {
        'Authorization': `Bearer ${newToken}`,
      },
    });

    if (userResponse.ok) {
      const userData = await userResponse.json();
      setUser(userData);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
    }
  };

  const register = async (email: string, username: string, password: string, fullName?: string) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        username,
        password,
        full_name: fullName,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    // Auto-login after registration
    await login(email, password);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  const updateUser = async (updates: { username?: string; full_name?: string; kobo_api_url?: string }) => {
    const response = await authFetch('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Update failed');
    }

    const userData = await response.json();
    setUser(userData);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  };

  const setKoboApiKey = async (apiKey: string) => {
    const response = await authFetch('/api/users/me/kobo-api-key', {
      method: 'PUT',
      body: JSON.stringify({ kobo_api_token: apiKey }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to set API key');
    }

    const userData = await response.json();
    setUser(userData);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  };

  const deleteKoboApiKey = async () => {
    const response = await authFetch('/api/users/me/kobo-api-key', {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete API key');
    }

    const userData = await response.json();
    setUser(userData);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  };

  const testKoboApiKey = async () => {
    const response = await authFetch('/api/users/me/kobo-api-key/test');

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to test API key');
    }

    return response.json();
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    // Passwords go in the JSON body, never the query string -- a URL would be
    // recorded in access logs, proxy logs and browser history.
    const response = await authFetch('/api/users/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to change password');
    }
  };

  const deleteAccount = async () => {
    const response = await authFetch('/api/users/me', {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete account');
    }

    logout();
  };

  const refreshUser = async () => {
    const response = await authFetch('/api/users/me');
    if (response.ok) {
      const userData = await response.json();
      setUser(userData);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        login,
        register,
        logout,
        updateUser,
        setKoboApiKey,
        deleteKoboApiKey,
        testKoboApiKey,
        changePassword,
        deleteAccount,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

