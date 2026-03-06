import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { FakePaymentGatewayService } from './fake-payment-gateway.service';
import { PaymentOrderMessage } from '../events/payment-queue.interface';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly gateway: FakePaymentGatewayService,
    private readonly metricsService: MetricsService,
  ) {}

  async processPayment(message: PaymentOrderMessage): Promise<Payment> {
    const existing = await this.paymentRepository.findOne({
      where: { orderId: message.orderId },
    });

    if (existing) {
      this.logger.warn(
        `⚠️ Payment already exists for orderId=${message.orderId} — skipping`,
      );
      return existing;
    }

    const payment = this.paymentRepository.create({
      orderId: message.orderId,
      userId: message.userId,
      amount: message.amount,
      paymentMethod: message.paymentMethod,
      status: PaymentStatus.PENDING,
    });

    await this.paymentRepository.save(payment);

    const result = await this.gateway.processPayment(
      message.amount,
      message.paymentMethod,
    );

    payment.transactionId = result.transactionId;
    payment.processedAt = new Date();

    if (result.approved) {
      payment.status = PaymentStatus.APPROVED;
    } else {
      payment.status = PaymentStatus.REJECTED;
      payment.rejectionReason = result.rejectionReason ?? null;
    }

    await this.paymentRepository.save(payment);

    this.metricsService.paymentsProcessedTotal.inc();

    if (payment.status === PaymentStatus.APPROVED) {
      this.metricsService.paymentsApprovedTotal.inc();
    } else {
      this.metricsService.paymentsRejectedTotal.inc({
        reason: this.normalizeRejectionReason(result.rejectionReason),
      });
    }

    this.logger.log(
      `💳 Payment processed: orderId=${payment.orderId}, status=${payment.status}, transactionId=${payment.transactionId}`,
    );

    return payment;
  }

  private normalizeRejectionReason(reason?: string): string {
    if (reason?.includes('Limite')) return 'limit_exceeded';
    if (reason?.includes('Cartão') || reason?.includes('operadora'))
      return 'card_declined';
    return 'unknown';
  }

  async findByOrderId(orderId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { orderId },
    });

    if (!payment) {
      throw new NotFoundException(
        `Pagamento não encontrado para orderId=${orderId}`,
      );
    }

    return payment;
  }
}
