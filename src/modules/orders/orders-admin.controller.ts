import { ROLE_GROUPS } from '@/shared/constants/role-groups.constant';
import { ErrorResponseDto } from '@/shared/dto/error-response.dto';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { CursorParamsPipe } from '@/shared/providers/pipes/cursor-params.pipe';
import type { CursorParams } from '@/shared/types/cursor-params.type';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { ORDERS_SERVICE } from './constants/orders.token';
import { OrderQueryDto } from './dto/order-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import type { IOrdersService } from './interfaces/orders-service.interface';

@Controller({ path: 'v1/admin/orders', version: '1' })
@ApiTags('orders-admin')
@ApiSecurity('bearer')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid authentication token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Insufficient permissions for this operation',
  type: ErrorResponseDto,
})
export class OrdersAdminController {
  constructor(
    @Inject(ORDERS_SERVICE) private readonly ordersService: IOrdersService,
  ) {}

  @Get()
  @Roles(...ROLE_GROUPS.ORDER.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get all orders',
    description:
      'Retrieve a cursor-paginated list of orders with optional filtering by user, status, or date range.',
  })
  @ApiOkResponse({
    description: 'Orders successfully retrieved',
    type: PagCursorResultDto,
  })
  @ApiQuery({ type: () => OrderQueryDto })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor from the previous page',
  })
  findAll(
    @Query() queryDto: OrderQueryDto,
    @Query('cursor', CursorParamsPipe) cursor: CursorParams,
  ) {
    return this.ordersService.adminFindAll(queryDto, cursor);
  }

  @Get(':id')
  @Roles(...ROLE_GROUPS.ORDER.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get order by ID',
    description: 'Retrieve a specific order by its unique identifier',
  })
  @ApiParam({
    name: 'id',
    description: 'Order unique identifier (UUID)',
  })
  @ApiOkResponse({
    description: 'Order successfully retrieved',
    type: OrderResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
    type: ErrorResponseDto,
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.adminFindOne(id);
  }

  @Patch(':id')
  @Roles(...ROLE_GROUPS.ORDER.MANAGEMENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an order',
    description: 'Update order details including status',
  })
  @ApiParam({
    name: 'id',
    description: 'Order unique identifier (UUID)',
  })
  @ApiOkResponse({
    description: 'Order successfully updated',
    type: OrderResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data',
    type: ErrorResponseDto,
  })
  @ApiBody({
    type: UpdateOrderDto,
    description: 'Order update data',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    return this.ordersService.adminUpdate(id, updateOrderDto);
  }

  @Delete(':id')
  @Roles(...ROLE_GROUPS.ORDER.MANAGEMENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an order',
    description:
      'Soft-deletes an order by deactivating it. Requires order management role.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order unique identifier (UUID)',
  })
  @ApiNoContentResponse({
    description: 'Order successfully deleted',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID format',
    type: ErrorResponseDto,
  })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.ordersService.adminRemove(id);
  }

  @Patch(':id/ship')
  @Roles(...ROLE_GROUPS.ORDER.SHIPPING)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark order as shipped',
    description:
      'Marks an order as shipped. The order must be in PROCESSED status. ' +
      'Optionally accepts tracking number and carrier information.',
  })
  @ApiParam({ name: 'id', description: 'Order unique identifier (UUID)' })
  @ApiBody({ type: ShipOrderDto, description: 'Shipping information' })
  @ApiOkResponse({
    description: 'Order successfully marked as shipped',
    type: OrderResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Order not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Order is not in a valid status for shipping',
    type: ErrorResponseDto,
  })
  ship(@Param('id', ParseUUIDPipe) id: string, @Body() shipOrderDto: ShipOrderDto) {
    return this.ordersService.ship(id, shipOrderDto);
  }

  @Patch(':id/deliver')
  @Roles(...ROLE_GROUPS.ORDER.DELIVERY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark order as delivered',
    description: 'Marks an order as delivered. The order must be in SHIPPED status.',
  })
  @ApiParam({ name: 'id', description: 'Order unique identifier (UUID)' })
  @ApiOkResponse({
    description: 'Order successfully marked as delivered',
    type: OrderResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Order not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Order is not in a valid status for delivery',
    type: ErrorResponseDto,
  })
  deliver(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.deliver(id);
  }

  @Patch(':id/cancel')
  @Roles(...ROLE_GROUPS.ORDER.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Cancels an order and releases reserved inventory. ' +
      'The order must be in PENDING, PAID, or PROCESSED status.',
  })
  @ApiParam({ name: 'id', description: 'Order unique identifier (UUID)' })
  @ApiNoContentResponse({ description: 'Order cancellation enqueued successfully' })
  @ApiNotFoundResponse({ description: 'Order not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Order is not in a valid status for cancellation',
    type: ErrorResponseDto,
  })
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    await this.ordersService.cancel(id);
  }

  @Patch(':id/refund')
  @Roles(...ROLE_GROUPS.ORDER.FINANCIAL)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refund an order',
    description:
      'Initiates a refund for an order. ' +
      'The order must be in PAID, PROCESSED, SHIPPED, or DELIVERED status.',
  })
  @ApiParam({ name: 'id', description: 'Order unique identifier (UUID)' })
  @ApiNoContentResponse({ description: 'Order refund enqueued successfully' })
  @ApiNotFoundResponse({ description: 'Order not found', type: ErrorResponseDto })
  @ApiBadRequestResponse({
    description: 'Order is not in a valid status for refunding',
    type: ErrorResponseDto,
  })
  async refund(@Param('id', ParseUUIDPipe) id: string) {
    await this.ordersService.refund(id);
  }
}
