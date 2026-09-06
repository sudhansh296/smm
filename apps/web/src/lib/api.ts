import axios, { type AxiosError } from "axios";

const BASE_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // sends HttpOnly cookies automatically
  headers: { "Content-Type": "application/json" },
});

// No request interceptor needed  --  HttpOnly cookie sent automatically via withCredentials

let isRefreshing = false;
// Issue 7 fix: queue stores both resolve and reject so hanging requests are
// properly rejected when refresh fails (not left pending forever)
let refreshQueue: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];

function flushQueue(error: unknown) {
  for (const { resolve, reject } of refreshQueue) {
    if (error) reject(error);
    else resolve();
  }
  refreshQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };

    // Pass through known auth errors that the UI handles directly
    const errCode = (error.response?.data as any)?.code;
    const requestUrl = original?.url ?? "";
    if (
      errCode === "EMAIL_NOT_VERIFIED" ||
      requestUrl.includes("/auth/login")
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        // Issue 7 fix: queue the request and wait for refresh to complete or fail
        return new Promise((resolve, reject) => {
          refreshQueue.push({
            resolve: () => resolve(api(original)),
            reject: (err) => reject(err),
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        // Refresh  --  backend sets new HttpOnly cookies automatically
        await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        // Issue 7 fix: resolve all queued requests now that we have new cookies
        flushQueue(null);
        return api(original); // retry original request  --  new cookie already set
      } catch (refreshError) {
        // Issue 7 fix: reject all queued requests so they don't hang forever
        flushQueue(refreshError);
        if (typeof window !== "undefined") window.location.href = "/login";
        return Promise.reject(refreshError);
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