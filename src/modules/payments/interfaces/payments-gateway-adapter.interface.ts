import { PagCursorResultDto } from '@/shared/dto/pag-cursor-result.dto';
import { CursorParams } from '@/shared/types/cursor-params.type';
import { CreatePgwCustomerDto } from '../dto/create-pgw-customer.dto';
import { CreatePgwPaymentDto } from '../dto/create-pgw-payment.dto';
import { CreatePgwRefundDto } from '../dto/create-pgw-refund.dto';
import { PgwCustomerResponseDto } from '../dto/pgw-customer-response.dto';
import { PgwPaymentResponseDto } from '../dto/pgw-payment-response.dto';
import { PgwRefundResponseDto } from '../dto/pgw-refund-response.dto';
import { UpdatePgwCustomerDto } from '../dto/update-pgw-customer.dto';

export interface PaymentsGatewayAdapter {
  createCustomer(dto: CreatePgwCustomerDto): Promise<PgwCustomerResponseDto>;

  findAllCustomers(
    cursor?: CursorParams,
  ): Promise<PagCursorResultDto<PgwCustomerResponseDto>>;

  findOneCustomer(customerId: string): Promise<PgwCustomerResponseDto>;

  updateCustomer(
    customerId: string,
    dto: UpdatePgwCustomerDto,
  ): Promise<PgwCustomerResponseDto>;

  deleteCustomer(customerId: string): Promise<void>;

  createPayment(dto: CreatePgwPaymentDto): Promise<PgwPaymentResponseDto>;

  findOnePayment(paymentId: string): Promise<PgwPaymentResponseDto>;

  createRefundPayment(dto: CreatePgwRefundDto): Promise<PgwRefundResponseDto>;

  findOneRefundPayment(refundId: string): Promise<PgwRefundResponseDto>;
}
