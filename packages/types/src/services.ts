export interface ServiceCategory {
  id: string;
  name: string;
  displayOrder: number;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  categoryName: string;
  providerId: string;
  providerServiceId: string;
  costPriceUsd: string;
  sellingPriceUsd: string;
  sellingPriceInr: string; // sellingPriceUsd × effectiveInrRate
  markupOverride: string | null;
  minQuantity: number;
  maxQuantity: number;
  isEnabled: boolean;
  supportsRefill: boolean;
  displayOrder: number;
}

export interface ServiceListQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
}

export interface ServiceListResponse {
  services: Service[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Provider {
  id: string;
  name: string;
  apiUrl: string;
  isEnabled: boolean;
  serviceCount: number;
  createdAt: string;
}

export interface ProviderServiceRaw {
  service: number | string;
  name: string;
  type: string;
  category: string;
  rate: string;
  min: string | number;
  max: string | number;
  refill?: boolean;
  cancel?: boolean;
}
