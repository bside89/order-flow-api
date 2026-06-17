import { I18N_PAYMENTS } from '@/shared/constants/i18n/i18n-payments.constant';
import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { BaseService } from '@/shared/providers/services/base.service';
import { EntityMapper } from '@/shared/utils/entity-mapper.utils';
import { template } from '@/shared/utils/functions.utils';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CUSTOMER_REPOSITORY,
  PAYMENT_REPOSITORY,
  PAYMENTS_GATEWAY_ADAPTER,
  REFUND_REPOSITORY,
} from './constants/payments.token';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { PaymentCursorQueryDto } from './dto/payment-cursor-query.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { RefundResponseDto } from './dto/refund-response.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import type { PaymentsGatewayAdapter } from './interfaces/payments-gateway-adapter.interface';
import { IPaymentsService } from './interfaces/payments-service.interface';
import { CustomerRepository } from './providers/repositories/customer.repository';
import { PaymentRepository } from './providers/repositories/payment.repository';
import { RefundRepository } from './providers/repositories/refund.repository';

@Injectable()
export class PaymentsService extends BaseService implements IPaymentsService {
  constructor(
    @Inject(PAYMENTS_GATEWAY_ADAPTER)
    private readonly pgwAdapter: PaymentsGatewayAdapter,
    @Inject(CUSTOMER_REPOSITORY)
    private readonly customerRepository: CustomerRepository,
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(REFUND_REPOSITORY)
    private readonly refundRepository: RefundRepository,
  ) {
    super(PaymentsService.name);
  }

  //#region Payments

  async createPayment(dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    const gatewayPayment = await this.pgwAdapter.createPayment(dto.gatewayDto);

    const payment = this.paymentRepository.createEntity({
      orderId: dto.orderId,
      userId: dto.userId,
      stripePaymentIntentId: gatewayPayment.id,
      stripeClientSecret: gatewayPayment.secret,
      status: gatewayPayment.status,
    });
    const saved = await this.paymentRepository.save(payment);

    return EntityMapper.map(saved, PaymentResponseDto);
  }

  async findAllPayments(
    query: PaymentCursorQueryDto,
  ): Promise<PagCursorResultDto<PaymentResponseDto>> {
    const payments = await this.paymentRepository.filter(query);

    return new PagCursorResultDto(
      payments.items.map((payment) => EntityMapper.map(payment, PaymentResponseDto)),
      payments.nextCursor,
      payments.hasMore,
    );
  }

  findOnePayment(paymentId: string): Promise<PaymentResponseDto> {
    return this.paymentRepository.findById(paymentId);
  }

  findPaymentByOrderId(orderId: string): Promise<PaymentResponseDto> {
    return this.paymentRepository.findOne({ where: { orderId } });
  }

  //#endregion

  //#region Customers

  async createCustomer(
    dto: CreateCustomerDto,
    idempotencyKey: string,
  ): Promise<CustomerResponseDto> {
    const gatewayCustomer = await this.pgwAdapter.createCustomer({
      email: dto.email,
      name: dto.name,
      idempotencyKey,
    });
    const customer = this.customerRepository.createEntity({
      gatewayCustomerId: gatewayCustomer.id,
      userId: dto.userId,
      email: dto.email,
      name: dto.name,
    });
    const saved = await this.customerRepository.save(customer);

    return EntityMapper.map(saved, CustomerResponseDto);
  }

  async findOneCustomer(customerId: string): Promise<CustomerResponseDto> {
    const customer = await this.customerRepository.findOne({
      where: { gatewayCustomerId: customerId },
    });
    if (!customer) {
      throw new NotFoundException(
        template(I18N_PAYMENTS.ERRORS.CUSTOMER_NOT_FOUND, {
          customerId,
        }),
      );
    }

    return EntityMapper.map(customer, CustomerResponseDto);
  }

  async findCustomerByUserId(userId: string): Promise<CustomerResponseDto> {
    const customer = await this.customerRepository.findOne({
      where: { userId },
    });
    if (!customer) {
      throw new NotFoundException(
        template(I18N_PAYMENTS.ERRORS.CUSTOMER_NOT_FOUND, {
          userId,
        }),
      );
    }

    return EntityMapper.map(customer, CustomerResponseDto);
  }

  async updateCustomer(dto: UpdateCustomerDto): Promise<CustomerResponseDto> {
    const customer = await this.customerRepository.findOne({
      where: { userId: dto.userId },
    });
    if (!customer) {
      throw new NotFoundException(
        template(I18N_PAYMENTS.ERRORS.CUSTOMER_NOT_FOUND, {
          userId: dto.userId,
        }),
      );
    }

    await this.pgwAdapter.updateCustomer(customer.gatewayCustomerId, {
      email: dto.email,
      name: dto.name,
    });

    customer.email = dto.email;
    customer.name = dto.name;
    await this.customerRepository.update(customer.id, customer);

    return EntityMapper.map(customer, CustomerResponseDto);
  }

  async deleteCustomer(userId: string): Promise<void> {
    const customer = await this.customerRepository.findOne({
      where: { userId },
    });
    if (!customer) {
      throw new NotFoundException(
        template(I18N_PAYMENTS.ERRORS.CUSTOMER_NOT_FOUND, { userId }),
      );
    }

    await this.pgwAdapter.deleteCustomer(customer.gatewayCustomerId);
    await this.customerRepository.softDelete(customer);
  }

  //#endregion

  //#region Refunds

  async createRefund(
    dto: CreateRefundDto,
    idempotencyKey: string,
  ): Promise<RefundResponseDto> {
    const payment = await this.paymentRepository.findOne({
      where: { orderId: dto.orderId },
    });
    if (!payment) {
      throw new NotFoundException(
        template(I18N_PAYMENTS.ERRORS.PAYMENT_NOT_FOUND, { orderId: dto.orderId }),
      );
    }
    const refundGateway = await this.pgwAdapter.createRefundPayment({
      paymentId: payment.id,
      amount: dto.amount,
      idempotencyKey,
    });
    const refund = this.refundRepository.createEntity({
      paymentId: payment.id,
      amount: dto.amount,
      gatewayRefundId: refundGateway.refundId,
    });
    const saved = await this.refundRepository.save(refund);

    return EntityMapper.map(saved, RefundResponseDto);
  }

  //#endregion
}
