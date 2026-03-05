import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { FakePaymentGatewayService } from './fake-payment-gateway.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  controllers: [PaymentsController],
  providers: [PaymentsService, FakePaymentGatewayService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
