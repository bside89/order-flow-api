import { PaymentsGatewayAdapter } from '@/modules/payments/interfaces/payments-gateway-adapter.interface';
import { randomUUID } from 'crypto';

const makeCustomer = (id: string) => ({
  id,
  email: 'test@test.com',
  name: 'Test Customer',
  metadata: { userId: 'user_test' },
  address: undefined,
});

const makePayment = (id: string) => ({
  id,
  status: 'requires_confirmation',
  secret: 'pi_test_mock_secret',
});

const makeRefund = (refundId: string) => ({
  refundId,
  paymentId: 'pi_test_mock',
  amount: 0,
});

export const paymentsGatewayServiceMock = {
  createCustomer: jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        makeCustomer(`cus_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`),
      ),
    ),
  findAllCustomers: jest.fn().mockResolvedValue({
    items: [makeCustomer('cus_test_list')],
    nextCursor: undefined,
    hasMore: false,
  }),
  findOneCustomer: jest.fn().mockResolvedValue(makeCustomer('cus_test_retrieve')),
  updateCustomer: jest.fn().mockResolvedValue(makeCustomer('cus_test_update')),
  deleteCustomer: jest.fn().mockResolvedValue(undefined),
  createPayment: jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        makePayment(`pi_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`),
      ),
    ),
  findOnePayment: jest.fn().mockResolvedValue(makePayment('pi_test_retrieve')),
  createRefundPayment: jest.fn().mockResolvedValue(makeRefund('re_test_create')),
  findOneRefundPayment: jest.fn().mockResolvedValue(makeRefund('re_test_retrieve')),
} as jest.Mocked<PaymentsGatewayAdapter>;
