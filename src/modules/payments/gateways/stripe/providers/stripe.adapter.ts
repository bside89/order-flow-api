import { CreatePgwCustomerDto } from '@/modules/payments/dto/create-pgw-customer.dto';
import { CreatePgwPaymentDto } from '@/modules/payments/dto/create-pgw-payment.dto';
import { CreatePgwRefundDto } from '@/modules/payments/dto/create-pgw-refund.dto';
import { PgwCustomerResponseDto } from '@/modules/payments/dto/pgw-customer-response.dto';
import { PgwPaymentResponseDto } from '@/modules/payments/dto/pgw-payment-response.dto';
import { PgwRefundResponseDto } from '@/modules/payments/dto/pgw-refund-response.dto';
import { UpdatePgwCustomerDto } from '@/modules/payments/dto/update-pgw-customer.dto';
import { PaymentsGatewayAdapter } from '@/modules/payments/interfaces/payments-gateway-adapter.interface';
import { I18N_PAYMENTS } from '@/shared/constants/i18n';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { CursorParams } from '@/shared/types/cursor-params.type';
import { ensureError, template } from '@/shared/utils/functions.utils';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from '../constants/stripe.token';
import {
  StripeCustomer,
  StripeCustomerCreateParams,
  StripePaymentIntent,
  StripePaymentIntentCreateParams,
  StripeRefund,
  StripeRefundCreateParams,
  StripWebhookParams,
} from '../types/stripe.type';

@Injectable()
export class StripeAdapter implements PaymentsGatewayAdapter {
  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe.Stripe) {}

  //#region Customers

  async createCustomer(dto: CreatePgwCustomerDto): Promise<PgwCustomerResponseDto> {
    try {
      const inputConverted = this.mapToStripeCustomerCreateParams(dto);

      const customer = await this.stripe.customers.create(inputConverted, {
        idempotencyKey: dto.idempotencyKey,
      });

      return this.mapToCustomerResult(customer);
    } catch (e) {
      const error = ensureError(e);
      throw new InternalServerErrorException(
        template(I18N_PAYMENTS.ERRORS.CREATE_CUSTOMER_FAILED),
        { cause: error },
      );
    }
  }

  async findAllCustomers(
    cursor?: CursorParams,
  ): Promise<PagCursorResultDto<PgwCustomerResponseDto>> {
    const limit = cursor?.limit || 20;

    const customers = await this.stripe.customers.list({
      limit,
      starting_after: cursor?.startingAfter,
    });

    return {
      items: customers.data.map((customer) => this.mapToCustomerResult(customer)),
      nextCursor: customers.has_more
        ? customers.data[customers.data.length - 1].id
        : undefined,
      hasMore: customers.has_more,
    };
  }

  async findOneCustomer(customerId: string): Promise<PgwCustomerResponseDto> {
    const customer = await this.stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      throw new NotFoundException(
        template(I18N_PAYMENTS.ERRORS.CUSTOMER_NOT_FOUND, { customerId }),
      );
    }
    return this.mapToCustomerResult(customer as StripeCustomer);
  }

  async updateCustomer(
    customerId: string,
    dto: UpdatePgwCustomerDto,
  ): Promise<PgwCustomerResponseDto> {
    try {
      const inputConverted = this.mapToStripeCustomerCreateParams(
        dto as CreatePgwCustomerDto,
      );

      const customer = await this.stripe.customers.update(
        customerId,
        inputConverted,
      );

      return this.mapToCustomerResult(customer);
    } catch (e) {
      const error = ensureError(e);
      throw new InternalServerErrorException(
        template(I18N_PAYMENTS.ERRORS.UPDATE_CUSTOMER_FAILED),
        { cause: error },
      );
    }
  }

  async deleteCustomer(customerId: string): Promise<void> {
    await this.stripe.customers.del(customerId);
  }

  //#endregion

  //#region Payments and Refunds

  async createPayment(dto: CreatePgwPaymentDto): Promise<PgwPaymentResponseDto> {
    const inputConverted = this.mapToStripePaymentIntentCreateParams(dto);

    const paymentIntent = await this.stripe.paymentIntents.create(inputConverted, {
      idempotencyKey: dto.idempotencyKey,
    });

    return this.mapToPaymentResult(paymentIntent);
  }

  async findOnePayment(paymentId: string): Promise<PgwPaymentResponseDto> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentId);
    return this.mapToPaymentResult(paymentIntent);
  }

  async createRefundPayment(dto: CreatePgwRefundDto): Promise<PgwRefundResponseDto> {
    const inputConverted = this.mapToRefundCreateParams(dto);

    const refund = await this.stripe.refunds.create(inputConverted, {
      idempotencyKey: dto.idempotencyKey,
    });

    return this.mapToRefundResponseDto(refund);
  }

  async findOneRefundPayment(refundId: string): Promise<PgwRefundResponseDto> {
    const refund = await this.stripe.refunds.retrieve(refundId);
    return this.mapToRefundResponseDto(refund);
  }

  //#endregion

  //#region Webhooks

  async processWebhook(params: StripWebhookParams): Promise<void> {
    const event = this.stripe.webhooks.constructEvent(
      params.payload,
      params.signature,
      process.env.STRIPE_WEBHOOK_SECRET || '',
    );

    switch (event.type) {
      case 'payment_intent.succeeded':
        // TODO: add event to outbox for Orders microservice to mark payment as succeeded
        break;
      case 'payment_intent.payment_failed':
        // TODO: add event to outbox for Orders microservice to mark payment as failed
        break;
      default:
        console.warn(`Unhandled Stripe webhook event type: ${event.type}`);
    }

    return Promise.resolve();
  }

  //#endregion

  //#region Private Methods

  private mapToStripeCustomerCreateParams(
    input: CreatePgwCustomerDto,
  ): StripeCustomerCreateParams {
    return {
      email: input.email,
      name: input.name,
      address: {
        city: input.address?.city,
        country: input.address?.country,
        line1: input.address?.line1,
        line2: input.address?.line2,
        postal_code: input.address?.postalCode,
        state: input.address?.state,
      },
      metadata: {
        userId: input.metadata?.userId,
      },
    };
  }

  private mapToCustomerResult(customer: StripeCustomer): PgwCustomerResponseDto {
    return {
      id: customer.id,
      name: customer.name || undefined,
      email: customer.email || undefined,
      metadata: customer.metadata
        ? {
            userId: customer.metadata.userId,
          }
        : undefined,
      address: customer.address
        ? {
            city: customer.address.city,
            country: customer.address.country,
            line1: customer.address.line1,
            line2: customer.address.line2,
            postalCode: customer.address.postal_code,
            state: customer.address.state,
          }
        : undefined,
    };
  }

  private mapToStripePaymentIntentCreateParams(
    input: CreatePgwPaymentDto,
  ): StripePaymentIntentCreateParams {
    return {
      amount: input.amount,
      currency: input.currency,
      customer: input.customerId,
      metadata: {
        orderId: input.metadata?.orderId,
      },
    };
  }

  private mapToPaymentResult(
    paymentIntent: StripePaymentIntent,
  ): PgwPaymentResponseDto {
    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      secret: paymentIntent.client_secret || undefined,
    };
  }

  private mapToRefundCreateParams(
    input: CreatePgwRefundDto,
  ): StripeRefundCreateParams {
    return {
      payment_intent: input.paymentId,
      amount: input.amount,
    };
  }

  private mapToRefundResponseDto(refund: StripeRefund): PgwRefundResponseDto {
    return {
      refundId: refund.id,
      paymentId: refund.payment_intent as string,
      amount: refund.amount,
    };
  }

  //#endregion
}
