export interface PaymentAdapter {
  name: string;
  createCheckout(deviceId: string, planId: string): Promise<{ checkoutUrl: string; reference: string }>;
  verifyPayment(reference: string): Promise<{ success: boolean; amount: number; paidAt: Date }>;
  handleWebhook(payload: unknown, signature: string): Promise<{ deviceId: string; amount: number; reference: string } | null>;
}

export interface SmsParser {
  parse(smsBody: string): { senderPhone: string; amount: number; transactionCode: string } | null;
}

export interface ManualCodeAdapter {
  issueCode(deviceId: string, durationDays: number): Promise<{ code: string; expiresAt: Date }>;
  redeemCode(code: string, deviceId: string): Promise<{ success: boolean; durationHours: number }>;
}
