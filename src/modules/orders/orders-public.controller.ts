import { resolveThrottleLimit } from '@/config/throttle.config';
import { I18N_COMMON } from '@/shared/constants/i18n';
import { GetUser } from '@/shared/decorators/get-user.decorator';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { CursorParamsPipe } from '@/shared/providers/pipes/cursor-params.pipe';
import type { CursorParams } from '@/shared/types/cursor-params.type';
import { template } from '@/shared/utils/functions.utils';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { RequestUser } from '../auth/interfaces/request-user.interface';
import { ORDERS_SERVICE } from './constants/orders.token';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderByUserQueryDto } from './dto/order-by-user-query.dto';
import { PublicOrderResponseDto } from './dto/order-response.dto';
import type { IOrdersService } from './interfaces/orders-service.interface';

@Controller({ path: 'v1/orders', version: '1' })
@ApiTags('orders')
@ApiSecurity('bearer')
@ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
export class OrdersPublicController {
  constructor(
    @Inject(ORDERS_SERVICE) private readonly ordersService: IOrdersService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: resolveThrottleLimit(10) } })
  @ApiOperation({
    summary: 'Create a new order',
    description:
      'Creates a new order with items and adds it to the processing queue. Requires idempotency-key header to prevent duplicate orders.',
  })
  @ApiHeader({
    name: 'idempotency-key',
    description:
      'Unique key to ensure idempotent requests. Use UUID or any unique string.',
    required: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiCreatedResponse({
    description: 'Order successfully created',
    type: PublicOrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data or missing idempotency-key header',
  })
  @ApiBody({
    type: CreateOrderDto,
    description: 'Order creation data',
  })
  create(
    @Body() createOrderDto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @GetUser() user: RequestUser,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException(
        template(I18N_COMMON.ERRORS.IDEMPOTENCY_KEY_REQUIRED),
      );
    }

    return this.ordersService.publicCreate(createOrderDto, user.id, idempotencyKey);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get my orders',
    description:
      'Retrieve a cursor-paginated list of orders belonging to the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Orders successfully retrieved',
    type: PagCursorResultDto,
  })
  @ApiQuery({ type: () => OrderByUserQueryDto })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor from the previous page',
  })
  findByUser(
    @Query() queryDto: OrderByUserQueryDto,
    @Query('cursor', CursorParamsPipe) cursor: CursorParams,
    @GetUser() user: RequestUser,
  ) {
    return this.ordersService.publicFindByUser(queryDto, user.id, cursor);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get order by ID',
    description:
      'Retrieve a specific order by its unique identifier. Only the owner can access their own orders.',
  })
  @ApiParam({
    name: 'id',
    description: 'Order unique identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'Order successfully retrieved',
    type: PublicOrderResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @ApiForbiddenResponse({
    description: 'Access to this order is not allowed',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID format',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: RequestUser) {
    return this.ordersService.publicFindOne(id, user);
  }
}
