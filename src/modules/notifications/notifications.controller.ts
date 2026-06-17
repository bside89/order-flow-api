import type { RequestUser } from '@/modules/auth/interfaces/request-user.interface';
import { GetUser } from '@/shared/decorators/get-user.decorator';
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
  Patch,
  Query,
} from '@nestjs/common';
import {
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
import { NOTIFICATIONS_SERVICE } from './constants/notifications.token';
import { NotificationResponseDto } from './dto/notification-response.dto';
import type { INotificationsService } from './interfaces/notifications-service.interface';

@Controller({ path: 'v1/notifications', version: '1' })
@ApiTags('notifications')
@ApiSecurity('bearer')
@ApiUnauthorizedResponse({
  description: 'Missing or invalid authentication token',
  type: ErrorResponseDto,
})
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notificationsService: INotificationsService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'List notifications',
    description:
      'Returns a cursor-paginated list of notifications for the authenticated user, ordered by most recent.',
  })
  @ApiOkResponse({
    description: 'Notifications retrieved successfully',
    type: PagCursorResultDto<NotificationResponseDto>,
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description: 'Pagination cursor from the previous page',
  })
  findByUser(
    @GetUser() user: RequestUser,
    @Query('cursor', CursorParamsPipe) cursor: CursorParams,
  ) {
    return this.notificationsService.findByUser({
      userId: user.id,
      language: user.language,
      cursor,
    });
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Marks a specific notification as read for the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification unique identifier (UUID)',
    type: String,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'Notification marked as read successfully',
    schema: { example: { success: true } },
  })
  @ApiNotFoundResponse({
    description: 'Notification not found or does not belong to the user',
    type: ErrorResponseDto,
  })
  async markAsRead(@GetUser() user: RequestUser, @Param('id') id: string) {
    await this.notificationsService.markAsRead(id, user.id);
    return { success: true };
  }

  @Get('unread/count')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Count unread notifications',
    description:
      'Returns the total count of unread notifications for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Unread notification count',
    schema: { type: 'number', example: 5 },
  })
  countUnread(@GetUser() user: RequestUser) {
    return this.notificationsService.countUnread(user.id);
  }

  @Get('has-new')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary: 'Check for new notifications',
    description:
      'Returns whether the authenticated user has any unread notifications.',
  })
  @ApiOkResponse({
    description: 'Indicates if there are unread notifications',
    schema: { type: 'boolean', example: true },
  })
  hasNewNotifications(@GetUser() user: RequestUser) {
    return this.notificationsService.hasNewNotifications(user.id);
  }
}
