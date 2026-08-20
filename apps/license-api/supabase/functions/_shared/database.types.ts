export interface Database {
  public: {
    Tables: {
      devices: {
        Row: {
          id: string;
          device_id: string;
          owner_phone: string | null;
          owner_email: string | null;
          activated_at: string;
          subscription_status: 'trial' | 'active' | 'expired';
          trial_ends_at: string;
          subscription_ends_at: string | null;
          paystack_customer_id: string | null;
          paystack_subscription_id: string | null;
          last_verify_at: string | null;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          device_id: string;
          owner_phone: string;
          owner_email: string;
          activated_at: string;
          subscription_status: 'trial' | 'active' | 'expired';
          trial_ends_at: string;
          subscription_ends_at: string;
          paystack_customer_id: string;
          paystack_subscription_id: string;
          last_verify_at: string;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          device_id: string;
          owner_phone: string;
          owner_email: string;
          activated_at: string;
          subscription_status: 'trial' | 'active' | 'expired';
          trial_ends_at: string;
          subscription_ends_at: string;
          paystack_customer_id: string;
          paystack_subscription_id: string;
          last_verify_at: string;
          created_at: string;
        }>;
      };
      plans: {
        Row: {
          id: string;
          device_id: string;
          name: string;
          duration_hours: number;
          price: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          device_id: string;
          name: string;
          duration_hours: number;
          price: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          device_id: string;
          name: string;
          duration_hours: number;
          price: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        }>;
      };
      vouchers: {
        Row: {
          id: string;
          code: string;
          device_id: string;
          plan_id: string | null;
          duration_hours: number;
          signature: string;
          is_used: boolean;
          used_by_mac: string | null;
          used_at: string | null;
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          code: string;
          device_id: string;
          plan_id: string;
          duration_hours: number;
          signature: string;
          is_used: boolean;
          used_by_mac: string;
          used_at: string;
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          code: string;
          device_id: string;
          plan_id: string;
          duration_hours: number;
          signature: string;
          is_used: boolean;
          used_by_mac: string;
          used_at: string;
          created_at: string;
        }>;
      };
      transactions: {
        Row: {
          id: string;
          device_id: string;
          voucher_code: string | null;
          plan_id: string | null;
          amount: number;
          paystack_ref: string | null;
          type: 'subscription' | 'voucher';
          status: 'success' | 'failed' | 'pending';
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          device_id: string;
          voucher_code: string;
          plan_id: string;
          amount: number;
          paystack_ref: string;
          type: 'subscription' | 'voucher';
          status: 'success' | 'failed' | 'pending';
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          device_id: string;
          voucher_code: string;
          plan_id: string;
          amount: number;
          paystack_ref: string;
          type: 'subscription' | 'voucher';
          status: 'success' | 'failed' | 'pending';
          created_at: string;
        }>;
      };
      connected_clients: {
        Row: {
          id: string;
          device_id: string;
          mac: string;
          ip: string | null;
          is_paid: boolean;
          expires_at: string | null;
          plan_name: string | null;
          last_seen_at: string;
        };
        Insert: Partial<{
          id: string;
          device_id: string;
          mac: string;
          ip: string;
          is_paid: boolean;
          expires_at: string;
          plan_name: string;
          last_seen_at: string;
        }>;
        Update: Partial<{
          id: string;
          device_id: string;
          mac: string;
          ip: string;
          is_paid: boolean;
          expires_at: string;
          plan_name: string;
          last_seen_at: string;
        }>;
      };
      admin_users: {
        Row: {
          id: string;
          email: string;
          role: 'owner' | 'developer';
          created_at: string;
        };
        Insert: Partial<{
          id: string;
          email: string;
          role: 'owner' | 'developer';
          created_at: string;
        }>;
        Update: Partial<{
          id: string;
          email: string;
          role: 'owner' | 'developer';
          created_at: string;
        }>;
      };
    };
    Functions: {
      check_entitlement: {
        Args: { p_device_id: string };
        Returns: { granted: boolean; status: string; expires_at: string | null }[];
      };
    };
  };
}
