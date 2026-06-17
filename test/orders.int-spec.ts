import { AppModule } from '@/app.module';
import { ITEMS_SERVICE } from '@/modules/items/constants/items.token';
import { IItemsService } from '@/modules/items/interfaces/items-service.interface';
import { ORDERS_SERVICE } from '@/modules/orders/constants/orders.token';
import { IOrdersService } from '@/modules/orders/interfaces/orders-service.interface';
import { OrderProcessor } from '@/modules/orders/providers/processors/order.processor';
import { ProcessOrderJobStrategy } from '@/modules/orders/providers/strategies/process-order-job.strategy';
import { PAYMENTS_GATEWAY_ADAPTER } from '@/modules/payments/constants/payments.token';
import { CreateCustomerJobStrategy } from '@/modules/payments/providers/strategies/create-customer-job.strategy';
import { USERS_SERVICE } from '@/modules/users/constants/users.token';
import { IUsersService } from '@/modules/users/interfaces/users-service.interface';
import { REDIS_CLIENT } from '@/shared/modules/cache/constants/redis-client.token';
import { OUTBOX_REPOSITORY } from '@/shared/modules/outbox/constants/outbox.token';
import { IOutboxRepository } from '@/shared/modules/outbox/interfaces/outbox-repository.interface';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { cleanDatabase, cleanRedis } from './utils/database-cleaner';
import { paymentsGatewayServiceMock } from './utils/mock-payments-gateway-service';
import { waitFor } from './utils/wait-for';

// Mock the delay function to resolve almost instantly.
// This eliminates the simulated processing delays (1s-3s) used by
// Job Strategies, making the pipeline tests much faster.
jest.mock('@/shared/utils/functions.utils', () => ({
  ...jest.requireActual('@/shared/utils/functions.utils'),
  delay: () => Promise.resolve(),
}));

// Override BullMQ backoff delay to 0 so retries happen immediately in tests,
// eliminating the exponential wait (2s, 4s, …) between job failure attempts.
jest.mock('@/config/bullmq.config', () => ({
  ...jest.requireActual('@/config/bullmq.config'),
  bullmqDefaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 0 },
    removeOnFail: { age: 24 * 3600 },
  },
}));

describe('Orders (Integration)', () => {
  let app: INestApplication;
  let usersService: IUsersService;
  let ordersService: IOrdersService;
  let itemsService: IItemsService;
  let outboxRepository: IOutboxRepository;
  let dataSource: DataSource;
  let redisClient: Redis;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENTS_GATEWAY_ADAPTER)
      .useValue(paymentsGatewayServiceMock)
      // Prevent PAYMENT_CREATE_CUSTOMER jobs from firing against a DB that may
      // have already been cleaned between tests. Order tests don't assert on
      // customer creation; mocking the strategy removes the race condition.
      .overrideProvider(CreateCustomerJobStrategy)
      .useValue({
        execute: jest.fn().mockResolvedValue(undefined),
        executeAfterFail: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = module.createNestApplication();
    await app.init();

    usersService = app.get<IUsersService>(USERS_SERVICE);
    ordersService = app.get<IOrdersService>(ORDERS_SERVICE);
    itemsService = app.get<IItemsService>(ITEMS_SERVICE);
    outboxRepository = app.get<IOutboxRepository>(OUTBOX_REPOSITORY);
    dataSource = app.get<DataSource>(DataSource);
    redisClient = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(dataSource);
    await cleanRedis(redisClient);
  });

  describe('Order Creation Flow', () => {
    it('should create an Order with status PENDING and no Outbox entries', async () => {
      // Arrange: create a real user via UsersService
      const createdUser = await usersService.publicCreate(
        {
          name: 'Integration User',
          email: 'integration@test.com',
          password: 'securePass123',
        },
        'idempotency-key-create-order-test',
      );
      const userId = createdUser.id;

      // Arrange: create two items at different prices
      const itemA = await itemsService.adminCreate(
        {
          name: 'Product AAA',
          description: 'Integration test item A',
          stock: 1000,
          price: 5000,
        },
        'idempotency-key-create-order-test-itemA',
      );
      const itemB = await itemsService.adminCreate(
        {
          name: 'Product BBB',
          description: 'Integration test item B',
          stock: 1000,
          price: 3000,
        },
        'idempotency-key-create-order-test-itemB',
      );

      // Act: create an order via OrdersService using the real user ID
      const createOrderDto = {
        items: [
          { itemId: itemA.id, quantity: 2 },
          { itemId: itemB.id, quantity: 1 },
        ],
      };
      await ordersService.publicCreate(
        createOrderDto,
        userId,
        'idempotency-key-order-1',
      );

      // Assert: verify the state directly in the database
      const orders = await dataSource.query(
        `SELECT id, "userId", status, total FROM orders WHERE "userId" = $1`,
        [userId],
      );
      expect(orders).toHaveLength(1);
      expect(orders[0].status).toBe('PENDING');
      expect(orders[0].total).toBe(13000); // (2 * 5000) + (1 * 3000)

      const orderItems = await dataSource.query(
        `SELECT "itemId", quantity FROM order_items WHERE "orderId" = $1 ORDER BY "itemId"`,
        [orders[0].id],
      );
      expect(orderItems).toHaveLength(2);
      expect(orderItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: itemA.id, quantity: 2 }),
          expect.objectContaining({ itemId: itemB.id, quantity: 1 }),
        ]),
      );

      // Assert: no ORDER_PROCESS in outbox — the processing pipeline only
      // starts after the payment webhook fires (markPaymentAsSucceeded).
      const outboxEntries = await dataSource.query(
        `SELECT id FROM outbox WHERE type = 'ORDER_PROCESS'`,
      );
      expect(outboxEntries).toHaveLength(0);
    });
  });

  describe('Order Queries', () => {
    it('should return only orders belonging to the provided user in findByUser', async () => {
      const firstUser = await usersService.publicCreate(
        {
          name: 'Query User One',
          email: 'query-user-one@test.com',
          password: 'securePass123',
        },
        'idempotency-key-query-user-one',
      );

      const secondUser = await usersService.publicCreate(
        {
          name: 'Query User Two',
          email: 'query-user-two@test.com',
          password: 'securePass123',
        },
        'idempotency-key-query-user-two',
      );

      const sharedItem = await itemsService.adminCreate(
        {
          name: 'Query Item',
          description: 'Item used to validate user filtered order queries',
          stock: 1000,
          price: 2500,
        },
        'idempotency-key-query-item',
      );

      const firstOrder = await ordersService.publicCreate(
        {
          items: [{ itemId: sharedItem.id, quantity: 1 }],
        },
        firstUser.id,
        'idempotency-key-query-order-one',
      );

      await ordersService.publicCreate(
        {
          items: [{ itemId: sharedItem.id, quantity: 1 }],
        },
        secondUser.id,
        'idempotency-key-query-order-two',
      );

      const result = await ordersService.publicFindByUser({}, firstUser.id);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe(firstOrder.id);
    });
  });

  describe('Transactional Atomicity', () => {
    it('should rollback the Order status update when Outbox insertion fails in markPaymentAsSucceeded', async () => {
      // Arrange: raw-insert user and item to avoid triggering Stripe customer
      // outbox entries that would interfere with the mockRejectedValueOnce spy.
      const [{ id: userId }] = await dataSource.query(
        `INSERT INTO "users" (name, email, password, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['Rollback User', 'rollback@test.com', 'securePass123', 'user'],
      );

      const [{ id: itemId }] = await dataSource.query(
        `INSERT INTO "items" (name, description, stock, price)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['Rollback Item', 'Used for rollback test', 10, 7500],
      );

      // Act: create the order (create() does not touch the outbox, so the spy
      // is not triggered here — paymentIntentsCreate is handled by the mock).
      const createOrderDto = { items: [{ itemId, quantity: 1 }] };
      const createdOrder = await ordersService.publicCreate(
        createOrderDto,
        userId,
        'idempotency-key-order-rollback',
      );
      const orderId = createdOrder.id;

      // Force OutboxRepository.save to throw on the next call, simulating a DB
      // failure that occurs inside the markPaymentAsSucceeded transaction.
      const saveSpy = jest
        .spyOn(outboxRepository, 'save')
        .mockRejectedValueOnce(new Error('Simulated Outbox insertion failure'));

      // Act: simulate the Stripe webhook callback — should fail due to Outbox error
      await expect(ordersService.markPaymentAsSucceeded(orderId)).rejects.toThrow(
        'Simulated Outbox insertion failure',
      );

      // Assert: the status update (PENDING → PAID) was rolled back
      const [order] = await dataSource.query(
        `SELECT status FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(order.status).toBe('PENDING');

      // Assert: no ORDER_PROCESS entry was persisted in the Outbox
      const outboxEntries = await dataSource.query(
        `SELECT id FROM outbox WHERE type = 'ORDER_PROCESS'`,
      );
      expect(outboxEntries).toHaveLength(0);

      saveSpy.mockRestore();
    });
  });

  describe('Order Full Processing Flow', () => {
    it('should process an Order through the entire async pipeline until DELIVERED status', async () => {
      // Arrange: create a real user
      const createdUser = await usersService.publicCreate(
        {
          name: 'Pipeline User',
          email: 'pipeline@test.com',
          password: 'securePass123',
        },
        'idempotency-key-full-flow-user',
      );
      const userId = createdUser.id;

      // Arrange: create items so the order total is deterministic
      const itemX = await itemsService.adminCreate(
        {
          name: 'Product XXX',
          description: 'Pipeline test item X',
          stock: 1000,
          price: 4000,
        },
        'idempotency-key-full-flow-itemX',
      );
      const itemY = await itemsService.adminCreate(
        {
          name: 'Product YYY',
          description: 'Pipeline test item Y',
          stock: 1000,
          price: 6000,
        },
        'idempotency-key-full-flow-itemY',
      );

      // Act: create an order — returns with PENDING status
      const createOrderDto = {
        items: [
          { itemId: itemX.id, quantity: 3 },
          { itemId: itemY.id, quantity: 2 },
        ],
      };
      const createdOrder = await ordersService.publicCreate(
        createOrderDto,
        userId,
        'idempotency-key-full-flow-order',
      );

      // Assert: order is initially PENDING
      expect(createdOrder.status).toBe('PENDING');

      const orderId = createdOrder.id;

      // Simulate the Stripe payment success webhook — sets PAID and enqueues ORDER_PROCESS.
      await ordersService.markPaymentAsSucceeded(orderId);

      // Wait for the async BullMQ pipeline to advance the order to PROCESSED.
      //   webhook → markPaymentAsSucceeded → PAID + Outbox → ORDER_PROCESS
      //   Outbox → ORDER_PROCESS → PROCESSED + EFFECTS_NOTIFY_USER
      //
      // delay() is mocked and setImmediate triggers process() after each add(),
      // so this resolves in ~10-50ms (BullMQ + Redis latency).
      await waitFor(
        async () => {
          const rows = await dataSource.query(
            `SELECT status FROM orders WHERE id = $1`,
            [orderId],
          );
          return rows.length === 1 && rows[0].status === 'PROCESSED';
        },
        10_000, // 10s timeout (1 BullMQ step + CI margin)
        250, // poll every 250ms
      );

      // Assert: order is PROCESSED after queue job completes
      const [processedOrder] = await dataSource.query(
        `SELECT status FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(processedOrder.status).toBe('PROCESSED');

      // Admin manually ships the order
      const shippedResult = await ordersService.ship(orderId, {
        trackingNumber: 'INT-TEST-123',
        carrier: 'Test Carrier',
      });
      expect(shippedResult.status).toBe('SHIPPED');
      expect(shippedResult.trackingNumber).toBe('INT-TEST-123');
      expect(shippedResult.carrier).toBe('Test Carrier');

      const [shippedOrder] = await dataSource.query(
        `SELECT status, "trackingNumber", carrier FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(shippedOrder.status).toBe('SHIPPED');
      expect(shippedOrder.trackingNumber).toBe('INT-TEST-123');
      expect(shippedOrder.carrier).toBe('Test Carrier');

      // Admin manually delivers the order
      const deliveredResult = await ordersService.deliver(orderId);
      expect(deliveredResult.status).toBe('DELIVERED');

      const [deliveredOrder] = await dataSource.query(
        `SELECT status, "deliveredAt" FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(deliveredOrder.status).toBe('DELIVERED');
      expect(deliveredOrder.deliveredAt).toBeDefined();
    }, 30_000); // Jest timeout: 30s (delay mocked + setImmediate replaces cron bottleneck)
  });

  describe('Order Compensation Flow', () => {
    it('should do the compensation logic and refund the Order when post-payment processing fails', async () => {
      // Arrange: force all ProcessOrderJobStrategy.execute() calls to fail.
      // This exhausts all BullMQ retries and triggers the executeAfterFail
      // compensation path. Since the order is in PAID status when the job
      // runs, compensationLogic enqueues ORDER_REFUND →
      // RefundOrderJobStrategy updates order to REFUNDED.
      const processOrderJobStrategy = app.get<ProcessOrderJobStrategy>(
        ProcessOrderJobStrategy,
      );
      const orderProcessor = app.get<OrderProcessor>(OrderProcessor);

      // Suppress error logs that are intentionally produced by this test:
      // BaseProcessor logs each of the 3 failed attempts, and the strategy
      // logs the final "after all retries" message. Both are expected here.
      const processorLogSpy = jest
        .spyOn((orderProcessor as any).logger, 'error')
        .mockImplementation(() => {});
      const strategyLogSpy = jest
        .spyOn((processOrderJobStrategy as any).logger, 'error')
        .mockImplementation(() => {});

      const processSpy = jest
        .spyOn(processOrderJobStrategy, 'execute')
        .mockRejectedValue(new Error('Simulated processing failure'));

      try {
        // Arrange: create a real user
        const createdUser = await usersService.publicCreate(
          {
            name: 'Compensation User',
            email: 'compensation@test.com',
            password: 'securePass123',
          },
          'idempotency-key-compensation-user',
        );
        const userId = createdUser.id;

        // Arrange: create an item for the order
        const compItem = await itemsService.adminCreate(
          {
            name: 'Compensation Item',
            description: 'Item for compensation test',
            stock: 1000,
            price: 3000,
          },
          'idempotency-key-compensation-item',
        );

        // Act: create an order — returns with PENDING status
        const createOrderDto = {
          items: [{ itemId: compItem.id, quantity: 2 }],
        };
        const createdOrder = await ordersService.publicCreate(
          createOrderDto,
          userId,
          'idempotency-key-compensation-order',
        );

        expect(createdOrder.status).toBe('PENDING');
        const orderId = createdOrder.id;

        // Simulate the Stripe payment success webhook.
        await ordersService.markPaymentAsSucceeded(orderId);

        // Wait for the compensation pipeline to complete:
        //   webhook → markPaymentAsSucceeded → PAID + Outbox → ORDER_PROCESS
        //   Outbox → ORDER_PROCESS → fails 3 times (backoff mocked to 0ms)
        //                         → executeAfterFail → compensationLogic
        //   Order is PAID → enqueues ORDER_REFUND
        //   Outbox → ORDER_REFUND → order = REFUNDED
        //
        // delay() is mocked and setImmediate triggers process() after each add().
        await waitFor(
          async () => {
            const rows = await dataSource.query(
              `SELECT status FROM orders WHERE id = $1`,
              [orderId],
            );
            return rows.length === 1 && rows[0].status === 'REFUNDED';
          },
          30_000, // 30s (3 BullMQ retries + refund step + CI margin)
          250,
        );

        // Assert: final order status is REFUNDED
        const [finalOrder] = await dataSource.query(
          `SELECT status FROM orders WHERE id = $1`,
          [orderId],
        );
        expect(finalOrder.status).toBe('REFUNDED');

        // Assert: outbox should be fully consumed (RefundOrderJobStrategy adds one
        // final EFFECTS_NOTIFY_USER entry; setImmediate dispatches it immediately)
        await waitFor(
          async () => {
            const rows = await dataSource.query(`SELECT id FROM outbox`);
            return rows.length === 0;
          },
          5_000,
          250,
        );
      } finally {
        processSpy.mockRestore();
        processorLogSpy.mockRestore();
        strategyLogSpy.mockRestore();
      }
    }, 45_000);

    it('should cancel the Order when the payment webhook reports a failure', async () => {
      // Arrange: when Stripe fires payment_intent.payment_failed, PaymentsService
      // calls ordersService.markPaymentAsFailed(), which enqueues ORDER_CANCEL.
      // CancelOrderJobStrategy then restores stock and sets the order to CANCELED.
      // The order never enters the processing pipeline.

      // Arrange: create a real user
      const createdUser = await usersService.publicCreate(
        {
          name: 'Payment Failure User',
          email: 'payment-failure@test.com',
          password: 'securePass123',
        },
        'idempotency-key-payment-failure-user',
      );
      const userId = createdUser.id;

      // Arrange: create an item for the order
      const failItem = await itemsService.adminCreate(
        {
          name: 'Payment Failure Item',
          description: 'Item for payment failure test',
          stock: 1000,
          price: 5000,
        },
        'idempotency-key-payment-failure-item',
      );

      // Act: create an order — returns with PENDING status
      const createOrderDto = {
        items: [{ itemId: failItem.id, quantity: 1 }],
      };
      const createdOrder = await ordersService.publicCreate(
        createOrderDto,
        userId,
        'idempotency-key-payment-failure-order',
      );

      expect(createdOrder.status).toBe('PENDING');
      const orderId = createdOrder.id;

      // Act: simulate the Stripe payment failure webhook.
      // This enqueues ORDER_CANCEL (without touching the order status directly).
      await ordersService.markPaymentAsFailed(orderId);

      // Wait for the cancellation pipeline to complete:
      //   webhook → markPaymentAsFailed → Outbox → ORDER_CANCEL
      //   Outbox → ORDER_CANCEL → restores stock + order = CANCELED
      //
      // delay() is mocked and setImmediate triggers process() after each add().
      await waitFor(
        async () => {
          const rows = await dataSource.query(
            `SELECT status FROM orders WHERE id = $1`,
            [orderId],
          );
          return rows.length === 1 && rows[0].status === 'CANCELED';
        },
        15_000, // 15s (ORDER_CANCEL step + CI margin)
        250,
      );

      // Assert: final order status is CANCELED
      const [finalOrder] = await dataSource.query(
        `SELECT status FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(finalOrder.status).toBe('CANCELED');

      // Assert: outbox should be fully consumed
      await waitFor(
        async () => {
          const rows = await dataSource.query(`SELECT id FROM outbox`);
          return rows.length === 0;
        },
        5_000,
        250,
      );
    }, 30_000);
  });

  describe('Concurrency and Locking', () => {
    it('should not execute the same Job twice simultaneously due to job-execute lock', async () => {
      const orderProcessor = app.get<OrderProcessor>(OrderProcessor);
      const processOrderJobStrategy = app.get<ProcessOrderJobStrategy>(
        ProcessOrderJobStrategy,
      );

      // We use a custom sleep since `delay` is mocked to resolve instantly
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      const executeSpy = jest
        .spyOn(processOrderJobStrategy, 'execute')
        .mockImplementation(async () => {
          await sleep(100); // Simulate processing time to hold the lock
        });

      const fakeJob = {
        id: 'concurrent-job-123',
        name: 'ORDER_PROCESS',
        data: {
          orderId: 'fake-order-id',
          userId: 'fake-user-id',
          userName: 'Test User',
        },
        opts: { attempts: 3 },
        attemptsMade: 0,
      } as Job<unknown>;

      try {
        // Execute the same job multiple times simultaneously
        await Promise.all([
          orderProcessor.process(fakeJob),
          orderProcessor.process(fakeJob),
          orderProcessor.process(fakeJob),
        ]);

        // The lock combined with idempotency should guarantee the strategy is
        // executed exactly once for the same job ID.
        expect(executeSpy).toHaveBeenCalledTimes(1);
      } finally {
        executeSpy.mockRestore();
      }
    });
  });
});
