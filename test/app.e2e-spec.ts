import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { FakePaymentGatewayService } from '../src/payments/fake-payment-gateway.service';
import { MetricsService } from '../src/metrics/metrics.service';

jest.setTimeout(15000);

const mockMetricsService = {
  paymentsProcessedTotal: { inc: jest.fn() },
  paymentsApprovedTotal: { inc: jest.fn() },
  paymentsRejectedTotal: { inc: jest.fn() },
  httpRequestsTotal: { inc: jest.fn() },
  httpRequestDuration: { observe: jest.fn() },
  getMetrics: jest.fn().mockResolvedValue(''),
  getContentType: jest.fn().mockReturnValue('text/plain'),
};

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Payment],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Payment]),
      ],
      controllers: [AppController, PaymentsController],
      providers: [
        AppService,
        PaymentsService,
        FakePaymentGatewayService,
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET / returns "Hello World!" (200)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('GET /payments/:orderId returns 404 for non-existent orderId', () => {
    return request(app.getHttpServer())
      .get('/payments/non-existent-order-id')
      .expect(404);
  });

  it('GET /payments/:orderId returns payment when found', async () => {
    const paymentsService = app.get(PaymentsService);
    const orderId = 'test-order-id';

    await paymentsService.processPayment({
      orderId,
      userId: 'test-user-id',
      amount: 100,
      paymentMethod: 'credit_card',
      items: [{ productId: 'prod-1', quantity: 1, price: 100 }],
    });

    const response = await request(app.getHttpServer())
      .get(`/payments/${orderId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      orderId,
      userId: 'test-user-id',
      amount: 100,
      paymentMethod: 'credit_card',
      status: 'approved',
    });
    expect(response.body.id).toBeDefined();
    expect(response.body.transactionId).toBeDefined();
    expect(response.body.processedAt).toBeDefined();
  });
});
