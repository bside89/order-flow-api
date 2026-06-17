import { resolveThrottleLimit } from '@/config/throttle.config';
import { JwtRefreshAuthGuard } from '@/modules/auth/providers/guards/jwt-refresh.guard';
import { GetUser } from '@/shared/decorators/get-user.decorator';
import { ErrorResponseDto } from '@/shared/dto/error-response.dto';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AUTH_SERVICE } from './constants/auth.token';
import { Public } from './decorators/public.decorator';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginDto } from './dto/login.dto';
import type { IAuthService } from './interfaces/auth-service.interface';
import type { RequestUser } from './interfaces/request-user.interface';

@Controller({ path: 'v1/auth', version: '1' })
@ApiTags('auth')
@ApiSecurity('bearer')
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly authService: IAuthService) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: resolveThrottleLimit(5) } })
  @ApiOperation({
    summary: 'User login',
    description:
      'Authenticates a user and returns access and refresh tokens. ' +
      'Requires email and password.',
  })
  @ApiCreatedResponse({
    description: 'Login successful',
    type: LoginResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid email or password',
  })
  @ApiBody({
    type: LoginDto,
    description: 'Login credentials',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtRefreshAuthGuard)
  @Throttle({ default: { limit: resolveThrottleLimit(20) } })
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Issues a new pair of access and refresh tokens. ' +
      'Send the refresh token (not the access token) in the Authorization header as a Bearer token.',
  })
  @ApiCreatedResponse({
    description: 'Tokens refreshed successfully',
    type: LoginResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or invalid refresh token',
    type: ErrorResponseDto,
  })
  refresh(@GetUser() user: RequestUser) {
    return this.authService.refresh(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: resolveThrottleLimit(20) } })
  @ApiOperation({
    summary: 'User logout',
    description: 'Invalidates the current refresh token, ending the session.',
  })
  @ApiNoContentResponse({
    description: 'Logout successful — no response body',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication token',
    type: ErrorResponseDto,
  })
  async logout(@GetUser() user: RequestUser) {
    await this.authService.logout(user);
  }
}
