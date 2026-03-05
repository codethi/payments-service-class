import { Controller, Get, Param } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Payment } from './payment.entity';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':orderId')
  async findByOrderId(@Param('orderId') orderId: string): Promise<Payment> {
    return this.paymentsService.findByOrderId(orderId);
  }
}
