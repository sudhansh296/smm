import type { ProviderServiceRaw } from "@nexussmm/types";
import { decryptProviderKey } from "../lib/crypto.js";
import type { Provider } from "@nexussmm/db";

/**
 * Client for talking to upstream SMM provider panels via the standard v2 API.
 */
export class ProviderClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(provider: Pick<Provider, "apiUrl" | "apiKeyEncrypted">) {
    this.apiUrl = provider.apiUrl;
    this.apiKey = decryptProviderKey(provider.apiKeyEncrypted);
  }

  private async post(params: Record<string, string>): Promise<unknown> {
    const body = new URLSearchParams({ key: this.apiKey, ...params });

    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!res.ok) {
      throw new Error(`Provider API HTTP ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  async getServices(): Promise<ProviderServiceRaw[]> {
    const data = await this.post({ action: "services" });
    if (!Array.isArray(data)) {
      throw new Error("Provider returned invalid services response");
    }
    return data as ProviderServiceRaw[];
  }

  async addOrder(
    serviceId: string,
    link: string,
    quantity: number,
  ): Promise<{ order: string | number } | { error: string }> {
    return this.post({
      action: "add",
      service: serviceId,
      link,
      quantity: quantity.toString(),
    }) as Promise<{ order: string | number } | { error: string }>;
  }

  async getStatus(
    providerOrderId: string,
  ): Promise<{
    charge?: string;
    start_count?: number;
    status?: string;
    remains?: number;
    error?: string;
  }> {
    return this.post({ action: "status", order: providerOrderId }) as Promise<{
      charge?: string;
      start_count?: number;
      status?: string;
      remains?: number;
      error?: string;
    }>;
  }

  async getMultiStatus(
    providerOrderIds: string[],
  ): Promise<Record<string, { status?: string; remains?: number; error?: string }>> {
    return this.post({
      action: "status",
      orders: providerOrderIds.join(","),
    }) as Promise<Record<string, { status?: string; remains?: number; error?: string }>>;
  }

  async requestRefill(
    providerOrderId: string,
  ): Promise<{ refill: string | number } | { error: string }> {
    return this.post({ action: "refill", order: providerOrderId }) as Promise<
      { refill: string | number } | { error: string }
    >;
  }

  async cancelOrder(
    providerOrderId: string,
  ): Promise<{ cancel: number } | { error: string }> {
    return this.post({
      action: "cancel",
      orders: providerOrderId,
    }) as Promise<{ cancel: number } | { error: string }>;
  }

  async getRefillStatus(refillId: string): Promise<{ refill: string | number; status?: string; error?: string } | { error: string }> {
    return this.post({ action: "refill_status", refill: refillId }) as Promise<
      { refill: string | number; status?: string; error?: string } | { error: string }
    >;
  }

  async testConnectivity(): Promise<boolean> {
    try {
      const data = await this.post({ action: "services" });
      return Array.isArray(data);
    } catch {
      return false;
    }
  }
}
