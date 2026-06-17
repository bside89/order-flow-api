import type { RequestUser } from '@/modules/auth/interfaces/request-user.interface';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { IBaseService } from '@/shared/providers/services/base-service.interface';
import type { CursorParams } from '@/shared/types/cursor-params.type';
import { CreateOrderDto } from '../dto/create-order.dto';
import { OrderByUserQueryDto } from '../dto/order-by-user-query.dto';
import { OrderQueryDto } from '../dto/order-query.dto';
import { OrderResponseDto, PublicOrderResponseDto } from '../dto/order-response.dto';
import { ShipOrderDto } from '../dto/ship-order.dto';
import { UpdateOrderDto } from '../dto/update-order.dto';

export interface IOrdersService extends IBaseService {
  publicCreate(
    dto: CreateOrderDto,
    userId: string,
    idempotencyKey: string,
  ): Promise<PublicOrderResponseDto>;

  publicFindByUser(
    queryDto: OrderByUserQueryDto,
    userId: string,
    cursor?: CursorParams,
  ): Promise<PagCursorResultDto<PublicOrderResponseDto>>;

  publicFindOne(
    id: string,
    requestUser: RequestUser,
  ): Promise<PublicOrderResponseDto>;

  adminFindAll(
    queryDto: OrderQueryDto,
    cursor?: CursorParams,
  ): Promise<PagCursorResultDto<OrderResponseDto>>;

  adminFindOne(id: string): Promise<OrderResponseDto>;

  adminUpdate(id: string, dto: UpdateOrderDto): Promise<OrderResponseDto>;

  adminRemove(id: string): Promise<void>;

  markPaymentAsSucceeded(orderId: string): Promise<OrderResponseDto>;

  markPaymentAsFailed(orderId: string): Promise<OrderResponseDto>;

  ship(id: string, dto: ShipOrderDto): Promise<OrderResponseDto>;

  deliver(id: string): Promise<OrderResponseDto>;

  cancel(id: string): Promise<void>;

  refund(id: string): Promise<void>;
}
