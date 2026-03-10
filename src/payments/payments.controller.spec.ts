import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: jest.Mocked<PaymentsService>;

  const mockPayment: Payment = {
    id: 'payment-uuid',
    orderId: 'order-uuid',
    userId: 'user-uuid',
    amount: 100,
    status: PaymentStatus.APPROVED,
    paymentMethod: 'credit_card',
    transactionId: 'tx-uuid',
    rejectionReason: null,
    processedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPaymentsService = {
      findByOrderId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    paymentsService = module.get(PaymentsService);
  });

  describe('findByOrderId', () => {
    it('returns payment when found', async () => {
      paymentsService.findByOrderId.mockResolvedValue(mockPayment);

      const result = await controller.findByOrderId('order-uuid');

      expect(result).toEqual(mockPayment);
      expect(paymentsService.findByOrderId).toHaveBeenCalledWith('order-uuid');
    });

    it('propagates NotFoundException', async () => {
      paymentsService.findByOrderId.mockRejectedValue(
        new NotFoundException('Pagamento não encontrado para orderId=non-existent'),
      );

      await expect(controller.findByOrderId('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.findByOrderId('non-existent')).rejects.toThrow(
        'Pagamento não encontrado para orderId=non-existent',
      );
    });
  });
});
