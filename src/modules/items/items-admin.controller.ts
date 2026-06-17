import { resolveThrottleLimit } from '@/config/throttle.config';
import { I18N_COMMON } from '@/shared/constants/i18n';
import { ROLE_GROUPS } from '@/shared/constants/role-groups.constant';
import { ErrorResponseDto } from '@/shared/dto/error-response.dto';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { CursorParamsPipe } from '@/shared/providers/pipes/cursor-params.pipe';
import type { CursorParams } from '@/shared/types/cursor-params.type';
import { template } from '@/shared/utils/functions.utils';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
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
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { ITEMS_SERVICE } from './constants/items.token';
import { CreateItemDto } from './dto/create-item.dto';
import { ItemQueryDto } from './dto/item-query.dto';
import { ItemResponseDto } from './dto/item-response.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import type { IItemsService } from './interfaces/items-service.interface';

@Controller({ path: 'v1/admin/items', version: '1' })
@ApiTags('items-admin')
@ApiSecurity('bearer')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid authentication token',
  type: ErrorResponseDto,
})
@ApiForbiddenResponse({
  description: 'Insufficient permissions for this operation',
  type: ErrorResponseDto,
})
export class ItemsAdminController {
  constructor(@Inject(ITEMS_SERVICE) private readonly itemsService: IItemsService) {}

  @Post()
  @Roles(...ROLE_GROUPS.COMMON.ADMIN_MANAGEMENT)
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: resolveThrottleLimit(10) } })
  @ApiOperation({
    summary: 'Create a new item',
    description:
      'Creates a new catalog item. Requires admin role. ' +
      'Requires idempotency-key header to prevent duplicate items.',
  })
  @ApiHeader({
    name: 'idempotency-key',
    description:
      'Unique key to ensure idempotent requests. Use UUID or any unique string.',
    required: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiCreatedResponse({
    description: 'Item successfully created',
    type: ItemResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data',
    type: ErrorResponseDto,
  })
  @ApiBody({ type: CreateItemDto, description: 'Item creation data' })
  async create(
    @Body() createItemDto: CreateItemDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException(
        template(I18N_COMMON.ERRORS.IDEMPOTENCY_KEY_REQUIRED),
      );
    }

    return this.itemsService.adminCreate(createItemDto, idempotencyKey);
  }

  @Get()
  @Roles(...ROLE_GROUPS.COMMON.ADMIN_MANAGEMENT)
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get all items (admin)',
    description:
      'Retrieve a cursor-paginated list of items with full details including payment gateway price ID.',
  })
  @ApiOkResponse({
    description: 'Items successfully retrieved',
    type: PagCursorResultDto,
  })
  @ApiQuery({ type: () => ItemQueryDto })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  findAll(
    @Query() queryDto: ItemQueryDto,
    @Query('cursor', CursorParamsPipe) cursor: CursorParams,
  ) {
    return this.itemsService.adminFindAll(queryDto, cursor);
  }

  @Get(':id')
  @Roles(...ROLE_GROUPS.COMMON.ADMIN_MANAGEMENT)
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({ summary: 'Get item by ID (admin)' })
  @ApiParam({
    name: 'id',
    description: 'Item unique identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'Item successfully retrieved',
    type: ItemResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Item not found', type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsService.adminFindOne(id);
  }

  @Patch(':id')
  @Roles(...ROLE_GROUPS.COMMON.ADMIN_MANAGEMENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an item', description: 'Requires admin role.' })
  @ApiParam({
    name: 'id',
    description: 'Item unique identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'Item successfully updated',
    type: ItemResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Item not found', type: ErrorResponseDto })
  @ApiBody({ type: UpdateItemDto, description: 'Item update data' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateItemDto: UpdateItemDto,
  ) {
    return this.itemsService.adminUpdate(id, updateItemDto);
  }

  @Delete(':id')
  @Roles(...ROLE_GROUPS.COMMON.ADMIN_MANAGEMENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an item',
    description: 'Soft-deletes a catalog item. Requires admin role.',
  })
  @ApiParam({
    name: 'id',
    description: 'Item unique identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiNoContentResponse({ description: 'Item successfully deleted' })
  @ApiNotFoundResponse({ description: 'Item not found', type: ErrorResponseDto })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.itemsService.adminRemove(id);
  }
}
