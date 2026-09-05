import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(amount: string | number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `$${isNaN(n) ? "0.00" : n.toFixed(2)}`;
}

export function formatInr(amount: string | number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `â‚¹${isNaN(n) ? "0.00" : n.toFixed(2)}`;
}

export function formatBalance(usd: string, inr: string): string {
  return `${formatUsd(usd)} (${formatInr(inr)})`;
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800",
    FORWARDING: "bg-yellow-100 text-yellow-800",
    FORWARDING: "bg-blue-50 text-blue-600",
    PROCESSING: "bg-blue-100 text-blue-800",
    IN_PROGRESS: "bg-indigo-100 text-indigo-800",
    COMPLETED: "bg-green-100 text-green-800",
    PARTIAL: "bg-orange-100 text-orange-800",
    CANCEL_REQUESTED: "bg-orange-100 text-orange-800",
    CANCELLED: "bg-red-100 text-red-800",
    REFUNDED: "bg-gray-100 text-gray-800",
  };
  return map[status] ?? "bg-gray-100 text-gray-800";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
