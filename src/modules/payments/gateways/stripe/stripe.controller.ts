import { Public } from '@/modules/auth/decorators/public.decorator';
import { StripeWebhookResult } from '@/modules/payments/gateways/stripe/types/stripe.type';
import { ErrorResponseDto } from '@/shared/dto/error-response.dto';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBody,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { StripeAdapter } from './providers/stripe.adapter';

@Controller('stripe')
@ApiTags('payments')
export class StripeController {
  constructor(private readonly stripeAdapter: StripeAdapter) {}

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook handler',
    description:
      'Receives and processes Stripe webhook events (e.g. payment_intent.succeeded, charge.refunded). ' +
      'This endpoint is called by Stripe and must not be invoked directly. ' +
      'The raw request body is required for signature verification.',
  })
  @ApiHeader({
    name: 'stripe-signature',
    description:
      'Stripe webhook signature for verifying event authenticity (set automatically by Stripe)',
    required: true,
    example: 't=1692816507,v1=abc123...',
  })
  @ApiOkResponse({
    description: 'Webhook event processed successfully',
  })
  @ApiBadRequestResponse({
    description: "Missing 'stripe-signature' header or invalid webhook payload",
    type: ErrorResponseDto,
  })
  async processWebhook(
    @RawBody() rawBody: Buffer,
    @Headers('stripe-signature') signature: string,
  ): Promise<StripeWebhookResult> {
    if (!signature) {
      throw new BadRequestException("The 'stripe-signature' header is required.");
    }
    await this.stripeAdapter.processWebhook({
      eventType: 'stripe-webhook',
      payload: rawBody,
      signature,
    });
    return { received: true };
  }
}
