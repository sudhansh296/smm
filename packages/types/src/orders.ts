export type OrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL"
  | "CANCELLED"
  | "REFUNDED";

export interface Order {
  id: string;
  userId: string;
  serviceId: string;
  serviceName: string;
  categoryName: string;
  link: string;
  quantity: number;
  costUsd: string;
  costInr: string; // costUsd × inrRateAtOrder
  inrRateAtOrder: string;
  status: OrderStatus;
  providerOrderId: string | null;
  startCount: number | null;
  remains: number | null;
  refillRequestedAt: string | null;
  refillStatus: string | null;
  supportsRefill: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderInput {
  serviceId: string;
  link: string;
  quantity: number;
}

export interface CreateOrderResponse {
  orderId: string;
  costUsd: string;
  costInr: string;
  status: OrderStatus;
}

export interface OrderListQuery {
  page?: number;
  limit?: number;
  status?: OrderStatus;
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
