import { NotificationEvent } from '@/modules/notifications/enums/notification-event.enum';
import { NotificationType } from '@/modules/notifications/enums/notification-type.enum';
import { I18N_ORDERS } from '@/shared/constants/i18n';
import { LOCK_KEY } from '@/shared/constants/lock.key';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { IDEMPOTENCY_SERVICE } from '@/shared/modules/cache/constants/idempotency.token';
import { ORDER_KEY } from '@/shared/modules/cache/constants/order.key';
import type { IIdempotencyService } from '@/shared/modules/cache/interfaces/idempotency-service.interface';
import { DbGuardService } from '@/shared/modules/db-guard/db-guard.service';
import { OUTBOX_SERVICE } from '@/shared/modules/outbox/constants/outbox.token';
import type { IOutboxService } from '@/shared/modules/outbox/interfaces/outbox-service.interface';
import { NotifyUserJobPayload } from '@/shared/payloads/effects-job.payload';
import {
  CancelOrderJobPayload,
  ProcessOrderJobPayload,
  RefundOrderJobPayload,
} from '@/shared/payloads/orders-job.payload';
import { BaseService } from '@/shared/providers/services/base.service';
import type { CursorParams } from '@/shared/types/cursor-params.type';
import { EntityMapper } from '@/shared/utils/entity-mapper.utils';
import { template } from '@/shared/utils/functions.utils';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '../auth/interfaces/request-user.interface';
import { ITEMS_SERVICE } from '../items/constants/items.token';
import type { IItemsService } from '../items/interfaces/items-service.interface';
import { PAYMENTS_SERVICE } from '../payments/constants/payments.token';
import { PaymentResponseDto } from '../payments/dto/payment-response.dto';
import type { IPaymentsService } from '../payments/interfaces/payments-service.interface';
import { ORDER_ITEM_REPOSITORY, ORDER_REPOSITORY } from './constants/orders.token';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderByUserQueryDto } from './dto/order-by-user-query.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderResponseDto, PublicOrderResponseDto } from './dto/order-response.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import {
  languageToCurrency,
  languageToLocale,
  toCurrencyFormatted,
} from './helpers/order-functions';
import { OrderTransitionPolicy } from './helpers/order-transition-policy';
import type { IOrderItemRepository } from './interfaces/order-item-repository.interface';
import type { IOrderRepository } from './interfaces/order-repository.interface';
import { IOrdersService } from './interfaces/orders-service.interface';

@Injectable()
export class OrdersService extends BaseService implements IOrdersService {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: IOrderRepository,
    @Inject(ORDER_ITEM_REPOSITORY)
    private readonly orderItemRepository: IOrderItemRepository,
    @Inject(ITEMS_SERVICE) private readonly itemsService: IItemsService,
    @Inject(OUTBOX_SERVICE) private readonly outboxService: IOutboxService,
    @Inject(PAYMENTS_SERVICE)
    private readonly paymentsService: IPaymentsService,
    @Inject(IDEMPOTENCY_SERVICE)
    private readonly idempotencyService: IIdempotencyService,
    private readonly guard: DbGuardService,
  ) {
    super(OrdersService.name);
  }

  //#region Public endpoints

  publicCreate(
    dto: CreateOrderDto,
    userId: string,
    idempotencyKey: string,
  ): Promise<PublicOrderResponseDto> {
    return this.guard.lockAndTransaction(
      LOCK_KEY.ORDER.CREATE(idempotencyKey),
      async () =>
        this.idempotencyService.getOrExecute(
          ORDER_KEY.IDEMPOTENCY('create', idempotencyKey),
          async () => this._publicCreate(dto, userId, idempotencyKey),
        ),
    );
  }

  private async _publicCreate(
    dto: CreateOrderDto,
    userId: string,
    idempotencyKey: string,
  ): Promise<PublicOrderResponseDto> {
    const catalogItems = await this.itemsService.validateAndGetCatalogItems(
      dto.items.map((i) => i.itemId),
    );
    let order = await this.createOrderWithItems(dto, userId, catalogItems);

    await this.decrementItemsStock(dto, catalogItems);

    order = await this.getOrderOrThrow(order.id);

    const payment = await this.paymentsService.createPayment({
      orderId: order.id,
      userId,
      gatewayDto: {
        amount: order.total,
        currency: languageToCurrency(order.user.language),
        metadata: {
          orderId: order.id,
        },
        idempotencyKey: `payment-${order.id}-${idempotencyKey}`,
      },
    });
    order.paymentId = payment.id;
    await this.orderRepository.save(order);

    await this.dispatchOrderCreatedNotification(order, order.total);

    const orderMapped = EntityMapper.map(order, PublicOrderResponseDto);
    orderMapped.payment = EntityMapper.map(payment, PaymentResponseDto);

    this.logger.debug('Order created', {
      idempotencyKey: idempotencyKey,
      orderId: order.id,
    });

    return orderMapped;
  }

  async publicFindByUser(
    queryDto: OrderByUserQueryDto,
    userId: string,
    cursor?: CursorParams,
  ): Promise<PagCursorResultDto<PublicOrderResponseDto>> {
    const result = await this.orderRepository.filter({
      ...queryDto,
      userId,
      cursor,
    });

    this.logger.debug(`Found ${result.items.length} orders for user ${userId}`);

    return new PagCursorResultDto<PublicOrderResponseDto>(
      EntityMapper.mapArray(result.items, PublicOrderResponseDto),
      result.nextCursor,
      result.hasMore,
    );
  }

  async publicFindOne(
    id: string,
    requestUser: RequestUser,
  ): Promise<PublicOrderResponseDto> {
    const order = await this.getOrderOrThrow(id);

    if (order.userId !== requestUser.id) {
      throw new ForbiddenException(template(I18N_ORDERS.ERRORS.ACCESS_DENIED));
    }

    const payment = await this.paymentsService.findOnePayment(order.payment.id);

    const orderMapped = EntityMapper.map(order, PublicOrderResponseDto);
    orderMapped.payment = EntityMapper.map(payment, PaymentResponseDto);

    this.logger.debug('Found order', { orderId: id });

    return orderMapped;
  }

  //#endregion

  //#region Admin endpoints

  async adminFindAll(
    queryDto: OrderQueryDto,
    cursor?: CursorParams,
  ): Promise<PagCursorResultDto<OrderResponseDto>> {
    const result = await this.orderRepository.filter({ ...queryDto, cursor });

    this.logger.debug(`Found ${result.items.length} orders`);

    return new PagCursorResultDto<OrderResponseDto>(
      EntityMapper.mapArray(result.items, OrderResponseDto),
      result.nextCursor,
      result.hasMore,
    );
  }

  async adminFindOne(id: string): Promise<OrderResponseDto> {
    const order = await this.getOrderOrThrow(id);

    const payment = await this.paymentsService.findOnePayment(order.payment.id);

    const orderMapped = EntityMapper.map(order, OrderResponseDto);
    orderMapped.payment = EntityMapper.map(payment, PaymentResponseDto);

    this.logger.debug('Found order', { orderId: id });

    return orderMapped;
  }

  adminUpdate(id: string, dto: UpdateOrderDto): Promise<OrderResponseDto> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(id), async () =>
      this._adminUpdate(id, dto),
    );
  }

  private async _adminUpdate(
    id: string,
    dto: UpdateOrderDto,
  ): Promise<OrderResponseDto> {
    const order = await this.getOrderOrThrow(id);

    Object.assign(order, dto);
    await this.orderRepository.save(order);

    await this.dispatchNotification(
      order.user.id,
      NotificationType.PUSH,
      NotificationEvent.ORDER_STATUS_CHANGED,
      { status: order.status },
    );

    this.logger.debug('Order updated', { orderId: id });

    return EntityMapper.map(order, OrderResponseDto);
  }

  adminRemove(id: string): Promise<void> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.REMOVE(id), async () =>
      this._adminRemove(id),
    );
  }

  private async _adminRemove(id: string): Promise<void> {
    const order = await this.getOrderOrThrow(id);

    await this.orderRepository.softDelete(order);

    this.logger.debug('Order deactivated', { orderId: id });
  }

  ship(id: string, dto: ShipOrderDto): Promise<OrderResponseDto> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(id), async () =>
      this._ship(id, dto),
    );
  }

  private async _ship(id: string, dto: ShipOrderDto): Promise<OrderResponseDto> {
    const order = await this.getOrderOrThrow(id);

    if (!OrderTransitionPolicy.canTransition(order.status, OrderStatus.SHIPPED)) {
      throw new BadRequestException(
        template(I18N_ORDERS.ERRORS.BAD_PRECONDITIONS, {
          status: OrderStatus.SHIPPED,
          currentStatus: order.status,
        }),
      );
    }

    order.status = OrderStatus.SHIPPED;
    order.shippedAt = new Date();
    if (dto.trackingNumber !== undefined) order.trackingNumber = dto.trackingNumber;
    if (dto.carrier !== undefined) order.carrier = dto.carrier;

    await this.orderRepository.save(order);

    await this.dispatchNotification(
      order.user.id,
      NotificationType.PUSH,
      NotificationEvent.ORDER_SHIPPED,
    );

    this.logger.debug('Order shipped', { orderId: id });

    return EntityMapper.map(order, OrderResponseDto);
  }

  deliver(id: string): Promise<OrderResponseDto> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(id), async () =>
      this._deliver(id),
    );
  }

  private async _deliver(id: string): Promise<OrderResponseDto> {
    const order = await this.getOrderOrThrow(id);

    if (!OrderTransitionPolicy.canTransition(order.status, OrderStatus.DELIVERED)) {
      throw new BadRequestException(
        template(I18N_ORDERS.ERRORS.BAD_PRECONDITIONS, {
          status: OrderStatus.DELIVERED,
          currentStatus: order.status,
        }),
      );
    }

    order.status = OrderStatus.DELIVERED;
    order.deliveredAt = new Date();

    await this.orderRepository.save(order);

    await this.dispatchNotification(
      order.user.id,
      NotificationType.PUSH,
      NotificationEvent.ORDER_DELIVERED,
    );

    this.logger.debug('Order delivered', { orderId: id });
    return EntityMapper.map(order, OrderResponseDto);
  }

  cancel(id: string): Promise<void> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(id), async () =>
      this._cancel(id),
    );
  }

  private async _cancel(id: string): Promise<void> {
    const order = await this.getOrderOrThrow(id);

    if (!OrderTransitionPolicy.canTransition(order.status, OrderStatus.CANCELED)) {
      throw new BadRequestException(
        template(I18N_ORDERS.ERRORS.BAD_PRECONDITIONS, {
          status: OrderStatus.CANCELED,
          currentStatus: order.status,
        }),
      );
    }

    await this.outboxService.add(new CancelOrderJobPayload(id));

    this.logger.debug('Order cancel enqueued', { orderId: id });
  }

  refund(id: string): Promise<void> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(id), async () =>
      this._refund(id),
    );
  }

  private async _refund(id: string): Promise<void> {
    const order = await this.getOrderOrThrow(id);

    if (!OrderTransitionPolicy.canTransition(order.status, OrderStatus.REFUNDED)) {
      throw new BadRequestException(
        template(I18N_ORDERS.ERRORS.BAD_PRECONDITIONS, {
          status: OrderStatus.REFUNDED,
          currentStatus: order.status,
        }),
      );
    }

    await this.outboxService.add(new RefundOrderJobPayload(id));

    this.logger.debug('Order refund enqueued', { orderId: id });
  }

  //#endregion

  //#region Webhook methods

  markPaymentAsSucceeded(orderId: string): Promise<OrderResponseDto> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(orderId), async () =>
      this._markPaymentAsSucceeded(orderId),
    );
  }

  private async _markPaymentAsSucceeded(orderId: string): Promise<OrderResponseDto> {
    const order = await this.getOrderOrThrow(orderId);

    order.status = OrderStatus.PAID;

    await this.orderRepository.save(order);

    // Kick off the order processing pipeline
    await this.outboxService.add(new ProcessOrderJobPayload(orderId));

    return EntityMapper.map(order, OrderResponseDto);
  }

  markPaymentAsFailed(orderId: string): Promise<OrderResponseDto> {
    return this.guard.lockAndTransaction(LOCK_KEY.ORDER.UPDATE(orderId), async () =>
      this._markPaymentAsFailed(orderId),
    );
  }

  private async _markPaymentAsFailed(orderId: string): Promise<OrderResponseDto> {
    const order = await this.getOrderOrThrow(orderId);

    // Enqueue the cancellation job (restores stock and updates status)
    await this.outboxService.add(new CancelOrderJobPayload(order.id));

    return EntityMapper.map(order, OrderResponseDto);
  }

  //#endregion

  //#region Private helper methods

  private async getOrderOrThrow(id: string): Promise<Order> {
    const order = await this.orderRepository.findById(id, {
      relations: ['user', 'items', 'payment'],
    });
    if (!order) {
      throw new NotFoundException(template(I18N_ORDERS.ERRORS.ORDER_NOT_FOUND));
    }
    return order;
  }

  private async createOrderWithItems(
    dto: CreateOrderDto,
    userId: string,
    catalogItems: Awaited<
      ReturnType<typeof this.itemsService.validateAndGetCatalogItems>
    >,
  ) {
    const total = dto.items.reduce((sum, dtoItem) => {
      const ci = catalogItems.find((ci) => ci.id === dtoItem.itemId)!;
      return sum + ci.price * dtoItem.quantity;
    }, 0);

    let order = this.orderRepository.createEntity({ userId, total });
    order = await this.orderRepository.save(order);

    const orderItems = dto.items.map((dtoItem) =>
      this.orderItemRepository.createEntity({
        itemId: dtoItem.itemId,
        quantity: dtoItem.quantity,
        orderId: order.id,
      }),
    );
    await this.orderItemRepository.saveBulk(orderItems);

    return order;
  }

  private async decrementItemsStock(
    dto: CreateOrderDto,
    catalogItems: Awaited<
      ReturnType<typeof this.itemsService.validateAndGetCatalogItems>
    >,
  ) {
    await Promise.all(
      dto.items.map((dtoItem) => {
        const item = catalogItems.find((ci) => ci.id === dtoItem.itemId);
        return this.itemsService.decrementItemStock(item, dtoItem.quantity);
      }),
    );
  }

  private async dispatchOrderCreatedNotification(
    order: Order,
    total: number,
  ): Promise<void> {
    const totalPrice = toCurrencyFormatted(
      total,
      languageToLocale(order.user.language),
      languageToCurrency(order.user.language),
    );
    await this.dispatchNotification(
      order.user.id,
      NotificationType.PUSH,
      NotificationEvent.ORDER_CREATED,
      { orderTotal: totalPrice },
    );
  }

  private async dispatchNotification(
    userId: string,
    type: NotificationType,
    event: NotificationEvent,
    data?: Record<string, any>,
  ): Promise<void> {
    await this.outboxService.add(
      new NotifyUserJobPayload(userId, type, event, data),
    );
  }

  //#endregion
}
