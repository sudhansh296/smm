import axios, { type AxiosError } from "axios";
import Cookies from "js-cookie";

const BASE_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Attach access token from cookie on every request
api.interceptors.request.use((config) => {
  const token = Cookies.get("accessToken");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            original.headers!["Authorization"] = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const res = await axios.post<{ accessToken: string }>(
          `${BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        const newToken = res.data.accessToken;
        Cookies.set("accessToken", newToken, { expires: 1 / 96 }); // 15 min
        api.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
        refreshQueue.forEach((cb) => cb(newToken));
        refreshQueue = [];
        original.headers!["Authorization"] = `Bearer ${newToken}`;
        return api(original);
      } catch {
        Cookies.remove("accessToken");
        if (typeof window !== "undefined") window.location.href = "/login";
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (
      (error.response?.data as { error?: string })?.error ??
      error.message ??
      "An error occurred"
    );
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred";
}
