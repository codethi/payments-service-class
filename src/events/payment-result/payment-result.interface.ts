export interface PaymentResultMessage {
  orderId: string;
  status: 'approved' | 'rejected';
  transactionId: string;
  rejectionReason: string | null;
  processedAt: string;
}
