import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface GatewayResult {
  approved: boolean;
  transactionId: string;
  rejectionReason?: string;
}

@Injectable()
export class FakePaymentGatewayService {
  private readonly logger = new Logger(FakePaymentGatewayService.name);

  async processPayment(
    amount: number,
    paymentMethod: string,
  ): Promise<GatewayResult> {
    const latency = Math.floor(Math.random() * 1501) + 500;
    this.logger.log(
      `🏦 Processing payment via ${paymentMethod} — simulated latency: ${latency}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, latency));

    const transactionId = randomUUID();

    if (amount > 10000) {
      return {
        approved: false,
        transactionId,
        rejectionReason: 'Limite excedido',
      };
    }

    const decimalPart = (amount % 1).toFixed(2);
    if (decimalPart === '0.99') {
      return {
        approved: false,
        transactionId,
        rejectionReason: 'Cartão recusado pela operadora',
      };
    }

    return { approved: true, transactionId };
  }
}
