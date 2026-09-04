import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile } from "@nexussmm/types";

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  setAuth: (user: UserProfile, token: string) => void;
  updateUser: (user: Partial<UserProfile>) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: (user, _accessToken) =>
        // accessToken is an HttpOnly cookie — we only persist the user profile
        set({ user, accessToken: null }),
      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),
      clearAuth: () => set({ user: null, accessToken: null }),
    }),
    {
      name: "nexussmm-auth",
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
