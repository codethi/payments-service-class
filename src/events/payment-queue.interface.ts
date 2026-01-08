export interface PaymentOrderMessage {
  orderId: string;
  userId: string;
  amount: number;
  items: Array<{
    productId: string; // ID do produto
    quantity: number; // Quantidade comprada
    price: number; // Preço unitário no momento da compra
  }>;
  paymentMethod: string;
  description?: string;
  createdAt?: Date;
  metadata?: {
    service: string;
    timestamp: string;
  };
}
