import { Module } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';
import { ConfigModule } from '@nestjs/config';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { PaymentConsumerService } from './payment-consumer/payment-consumer.service';
import { DlqService } from './dlq/dlq.service';
import { DlqController } from './dlq/dlq.controller';
import { MetricsController } from './metrics/metrics.controller';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentResultPublisherService } from './payment-result/payment-result-publisher.service';

@Module({
  imports: [ConfigModule, PaymentsModule],
  controllers: [DlqController, MetricsController],
  providers: [
    RabbitmqService,
    PaymentQueueService,
    PaymentConsumerService,
    DlqService,
    PaymentResultPublisherService,
  ],
  exports: [RabbitmqService],
})
export class EventsModule {}
