import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';
import { FakePaymentGatewayService } from './fake-payment-gateway.service';
import { MetricsService } from '../metrics/metrics.service';
import { PaymentOrderMessage } from '../events/payment-queue.interface';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepository: jest.Mocked<Repository<Payment>>;
  let gateway: jest.Mocked<FakePaymentGatewayService>;
  let metricsService: jest.Mocked<MetricsService>;

  const mockPayment: Partial<Payment> = {
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

  const mockMessage: PaymentOrderMessage = {
    orderId: 'order-uuid',
    userId: 'user-uuid',
    amount: 100,
    items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
  };

  beforeEach(async () => {
    const mockRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockGateway = {
      processPayment: jest.fn(),
    };

    const mockMetrics = {
      paymentsProcessedTotal: { inc: jest.fn() },
      paymentsApprovedTotal: { inc: jest.fn() },
      paymentsRejectedTotal: { inc: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockRepository,
        },
        {
          provide: FakePaymentGatewayService,
          useValue: mockGateway,
        },
        {
          provide: MetricsService,
          useValue: mockMetrics,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentRepository = module.get(getRepositoryToken(Payment));
    gateway = module.get(FakePaymentGatewayService);
    metricsService = module.get(MetricsService);
  });

  describe('processPayment', () => {
    it('should process and approve payment', async () => {
      paymentRepository.findOne.mockResolvedValue(null);
      paymentRepository.create.mockReturnValue({
        ...mockPayment,
        status: PaymentStatus.PENDING,
      } as Payment);
      paymentRepository.save.mockResolvedValue(mockPayment as Payment);
      gateway.processPayment.mockResolvedValue({
        approved: true,
        transactionId: 'tx-uuid',
      });

      const result = await service.processPayment(mockMessage);

      expect(paymentRepository.findOne).toHaveBeenCalledWith({
        where: { orderId: mockMessage.orderId },
      });
      expect(paymentRepository.create).toHaveBeenCalledWith({
        orderId: mockMessage.orderId,
        userId: mockMessage.userId,
        amount: mockMessage.amount,
        paymentMethod: mockMessage.paymentMethod,
        status: PaymentStatus.PENDING,
      });
      expect(gateway.processPayment).toHaveBeenCalledWith(
        mockMessage.amount,
        mockMessage.paymentMethod,
      );
      expect(metricsService.paymentsProcessedTotal.inc).toHaveBeenCalled();
      expect(metricsService.paymentsApprovedTotal.inc).toHaveBeenCalled();
      expect(metricsService.paymentsRejectedTotal.inc).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.APPROVED);
      expect(result.transactionId).toBe('tx-uuid');
    });

    it('should process and reject payment', async () => {
      paymentRepository.findOne.mockResolvedValue(null);
      const pendingPayment = {
        ...mockPayment,
        status: PaymentStatus.PENDING,
        transactionId: null,
        rejectionReason: null,
      };
      paymentRepository.create.mockReturnValue(pendingPayment as Payment);
      paymentRepository.save.mockImplementation((p) =>
        Promise.resolve({ ...p, ...mockPayment } as Payment),
      );
      gateway.processPayment.mockResolvedValue({
        approved: false,
        transactionId: 'tx-uuid',
        rejectionReason: 'Limite excedido',
      });

      const result = await service.processPayment({
        ...mockMessage,
        amount: 15000,
      });

      expect(gateway.processPayment).toHaveBeenCalledWith(15000, mockMessage.paymentMethod);
      expect(metricsService.paymentsProcessedTotal.inc).toHaveBeenCalled();
      expect(metricsService.paymentsRejectedTotal.inc).toHaveBeenCalledWith({
        reason: 'limit_exceeded',
      });
      expect(metricsService.paymentsApprovedTotal.inc).not.toHaveBeenCalled();
      expect(result.status).toBe(PaymentStatus.REJECTED);
      expect(result.rejectionReason).toBe('Limite excedido');
    });

    it('should return existing payment for duplicate orderId', async () => {
      const existingPayment = { ...mockPayment } as Payment;
      paymentRepository.findOne.mockResolvedValue(existingPayment);

      const result = await service.processPayment(mockMessage);

      expect(result).toBe(existingPayment);
      expect(paymentRepository.create).not.toHaveBeenCalled();
      expect(gateway.processPayment).not.toHaveBeenCalled();
      expect(metricsService.paymentsProcessedTotal.inc).not.toHaveBeenCalled();
    });
  });

  describe('findByOrderId', () => {
    it('should return payment', async () => {
      paymentRepository.findOne.mockResolvedValue(mockPayment as Payment);

      const result = await service.findByOrderId('order-uuid');

      expect(result).toEqual(mockPayment);
      expect(paymentRepository.findOne).toHaveBeenCalledWith({
        where: { orderId: 'order-uuid' },
      });
    });

    it('should throw NotFoundException', async () => {
      paymentRepository.findOne.mockResolvedValue(null);

      await expect(service.findByOrderId('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findByOrderId('non-existent')).rejects.toThrow(
        'Pagamento não encontrado para orderId=non-existent',
      );
    });
  });
});
