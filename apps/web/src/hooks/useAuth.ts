"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import type { UserProfile, LoginInput, RegisterInput } from "@nexussmm/types";
import { toast } from "sonner";

export function useAuth() {
  const { user, setAuth, clearAuth } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async (data: LoginInput & { totpCode?: string }) => {
      const res = await api.post<{
        accessToken: string;
        user: UserProfile;
        requiresTotpCode?: boolean;
        code?: string;
      }>("/auth/login", data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.requiresTotpCode) return;
      setAuth(data.user, "");
      toast.success("Logged in successfully");
      router.push("/dashboard");
    },
    onError: (err: any) => {
      // EMAIL_NOT_VERIFIED is handled by login page — don't show generic toast
      const code = err?.response?.data?.code;
      if (code === "EMAIL_NOT_VERIFIED") return;
      toast.error(getErrorMessage(err));
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterInput) => {
      const res = await api.post("/auth/register", data);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Account created! Please check your email to verify.");
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
    },
    onSuccess: () => {
      clearAuth();
      queryClient.clear();
      window.location.replace("/login");
    },
  });

  return {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin ?? false,
    login: loginMutation.mutate,
    loginAsync: loginMutation.mutateAsync,
    register: registerMutation.mutate,
    logout: logoutMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };
}