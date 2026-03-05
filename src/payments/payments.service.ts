import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { FakePaymentGatewayService } from './fake-payment-gateway.service';
import { PaymentOrderMessage } from '../events/payment-queue.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly gateway: FakePaymentGatewayService,
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

    this.logger.log(
      `💳 Payment processed: orderId=${payment.orderId}, status=${payment.status}, transactionId=${payment.transactionId}`,
    );

    return payment;
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
