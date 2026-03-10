import { FakePaymentGatewayService } from './fake-payment-gateway.service';

jest.setTimeout(10000);

describe('FakePaymentGatewayService', () => {
  let service: FakePaymentGatewayService;

  beforeEach(() => {
    service = new FakePaymentGatewayService();
  });

  it('should approve normal payment', async () => {
    const result = await service.processPayment(100, 'credit_card');

    expect(result.approved).toBe(true);
    expect(result.transactionId).toBeDefined();
    expect(result.rejectionReason).toBeUndefined();
  });

  it('should reject payment over 10000', async () => {
    const result = await service.processPayment(10001, 'credit_card');

    expect(result.approved).toBe(false);
    expect(result.rejectionReason).toBe('Limite excedido');
    expect(result.transactionId).toBeDefined();
  });

  it('should reject payment ending in .99', async () => {
    const result = await service.processPayment(99.99, 'credit_card');

    expect(result.approved).toBe(false);
    expect(result.rejectionReason).toBe('Cartão recusado pela operadora');
    expect(result.transactionId).toBeDefined();
  });

  it('should always return a transactionId', async () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const result1 = await service.processPayment(100, 'credit_card');
    const result2 = await service.processPayment(10001, 'credit_card');
    const result3 = await service.processPayment(99.99, 'debit_card');

    expect(result1.transactionId).toMatch(uuidRegex);
    expect(result2.transactionId).toMatch(uuidRegex);
    expect(result3.transactionId).toMatch(uuidRegex);
    expect(result1.transactionId).not.toBe(result2.transactionId);
    expect(result2.transactionId).not.toBe(result3.transactionId);
  });
});
