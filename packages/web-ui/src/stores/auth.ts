import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserInfo {
  id: string;
  name: string;
  email?: string;
  roleId?: string;
  scopes: string[];
}

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  setToken: (token: string) => void;
  setUser: (user: UserInfo) => void;
  logout: () => void;
  hasScope: (scope: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isAdmin: false,

      setToken: (token: string) => {
        set({ token, isAuthenticated: true });
      },

      setUser: (user: UserInfo) => {
        const isAdmin = user.scopes.includes('*') || user.roleId === 'role-admin';
        set({ user, isAdmin });
      },

      logout: () => {
        set({ token: null, user: null, isAuthenticated: false, isAdmin: false });
        localStorage.removeItem('token');
      },

      hasScope: (scope: string) => {
        const { user } = get();
        if (!user) return false;
        return user.scopes.includes('*') || user.scopes.includes(scope);
      },
    }),
    {
      name: 'mc-auth',
      partialize: (state) => ({ token: state.token }),
    }
  )
);

export async function fetchUserInfo(): Promise<UserInfo | null> {
  const token = useAuthStore.getState().token;
  if (!token) return null;

  try {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.user || null;
  } catch {
    return null;
  }
}
