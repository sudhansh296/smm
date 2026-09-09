import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UserProfile } from "@nexussmm/types";

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  hasHydrated: boolean;
  setAuth: (user: UserProfile, token: string) => void;
  updateUser: (user: Partial<UserProfile>) => void;
  clearAuth: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      hasHydrated: false,
      setAuth: (user, _accessToken) =>
        // accessToken is an HttpOnly cookie -- we only persist the user profile
        set({ user, accessToken: null }),
      updateUser: (partial) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        })),
      clearAuth: () => set({ user: null, accessToken: null }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "nexussmm-auth",
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        // Called when Zustand finishes rehydrating from localStorage
        state?.setHasHydrated(true);
      },
    },
  ),
);