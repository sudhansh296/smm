import axios, { type AxiosError } from "axios";

const BASE_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // sends HttpOnly cookies automatically
  headers: { "Content-Type": "application/json" },
});

// No request interceptor needed — HttpOnly cookie sent automatically via withCredentials

let isRefreshing = false;
let refreshQueue: Array<() => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push(() => resolve(api(original)));
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        // Refresh — backend sets new HttpOnly cookies automatically
        await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        refreshQueue.forEach((cb) => cb());
        refreshQueue = [];
        return api(original); // retry original request — new cookie already set
      } catch {
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
