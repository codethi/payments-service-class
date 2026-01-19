import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PaymentQueueService } from '../payment-queue/payment-queue.service';
import { PaymentOrderMessage } from '../payment-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class PaymentConsumerService implements OnModuleInit {
  private readonly logger = new Logger(PaymentConsumerService.name);

  constructor(
    private readonly paymentQueueService: PaymentQueueService,
    private readonly rabbitMQService: RabbitmqService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Starting Payment Consumer Service');
    await this.startConsuming();
  }

  async startConsuming() {
    try {
      this.logger.log('👂 Starting to consume payment orders from queue');

      const isConnected = await this.rabbitMQService.waitForConnection();

      if (!isConnected) {
        this.logger.error(
          '❌ Could not connect to RabbitMQ after multiple attempts',
        );
        return;
      }

      // Registra callback para processar cada mensagem
      // O bind(this) garante que o 'this' dentro do callback seja esta classe
      await this.paymentQueueService.consumePaymentOrders(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.processPaymentOrder.bind(this),
      );

      this.logger.log('✅ Payment Consumer Service started successfully');
    } catch (error) {
      this.logger.error('❌ Failed to start consuming payment orders:', error);
    }
  }

  private processPaymentOrder(message: PaymentOrderMessage): void {
    try {
      // Log inicial com informações da mensagem
      this.logger.log(
        `📝 Processing payment order: ` +
          `orderId=${message.orderId}, ` +
          `userId=${message.userId}, ` +
          `amount=${message.amount}`,
      );

      // Validar mensagem antes de processar
      if (!this.validateMessage(message)) {
        this.logger.error('❌ Invalid payment message received');
        // Rejeitamos a mensagem para não ficar reprocessando
        throw new Error('Invalid payment message received');
      }

      // TODO: Processar pagamento usando PaymentsService
      // Isso será implementado nas próximas aulas
      this.logger.log('✅ Payment order received and validated');
    } catch (error) {
      // Log de erro com contexto completo
      this.logger.error(
        `❌ Failed to process payment for order ${message.orderId}:`,
        error,
      );

      // IMPORTANTE: Relançamos o erro para o RabbitMQ fazer NACK
      throw error;
    }
  }

  private validateMessage(message: PaymentOrderMessage): boolean {
    // Verificações básicas
    if (!message.orderId) {
      this.logger.error('Missing orderId in payment message');
      return false;
    }

    if (!message.userId) {
      this.logger.error('Missing userId in payment message');
      return false;
    }

    if (!message.amount || message.amount <= 0) {
      this.logger.error('Invalid amount in payment message');
      return false;
    }

    if (!message.paymentMethod) {
      this.logger.error('Missing paymentMethod in payment message');
      return false;
    }

    // Validação dos itens
    if (!message.items || message.items.length === 0) {
      this.logger.error('No items in payment message');
      return false;
    }

    // Todas validações passaram
    return true;
  }
}
