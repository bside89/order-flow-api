import { ErrorResponseDto } from '@/shared/dto/error-response.dto';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { CursorParamsPipe } from '@/shared/providers/pipes/cursor-params.pipe';
import type { CursorParams } from '@/shared/types/cursor-params.type';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ITEMS_SERVICE } from './constants/items.token';
import { PublicItemQueryDto } from './dto/item-query.dto';
import { PublicItemResponseDto } from './dto/item-response.dto';
import type { IItemsService } from './interfaces/items-service.interface';

@Controller({ path: 'v1/items', version: '1' })
@ApiTags('items')
@ApiSecurity('bearer')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid authentication token',
  type: ErrorResponseDto,
})
export class ItemsPublicController {
  constructor(@Inject(ITEMS_SERVICE) private readonly itemsService: IItemsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all items',
    description: 'Retrieve a cursor-paginated list of items with optional filtering',
  })
  @ApiOkResponse({
    description: 'Items successfully retrieved',
    type: PagCursorResultDto,
  })
  @ApiQuery({ type: () => PublicItemQueryDto })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  findAll(
    @Query() queryDto: PublicItemQueryDto,
    @Query('cursor', CursorParamsPipe) cursor: CursorParams,
  ) {
    return this.itemsService.publicFindAll(queryDto, cursor);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get item by ID',
    description:
      'Retrieve the full details of a specific catalog item by its unique identifier.',
  })
  @ApiParam({
    name: 'id',
    description: 'Item unique identifier (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'Item successfully retrieved',
    type: PublicItemResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Item not found' })
  @ApiBadRequestResponse({ description: 'Invalid UUID format' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.itemsService.publicFindOne(id);
  }
}
