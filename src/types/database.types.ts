// Types alignes sur supabase/migrations/00**.sql (source de verite du backend).
// Regenerables via `supabase gen types typescript`, mais maintenus a la main
// pour garder des unions strictes sur les statuts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileRole = 'worker' | 'structure_admin';
export type MissionStatus = 'open' | 'closed' | 'cancelled';
export type MissionSector =
  | 'restauration'
  | 'vente'
  | 'logistique'
  | 'evenementiel'
  | 'nettoyage'
  | 'manutention'
  | 'administratif'
  | 'autre';
export type ApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed';
export type PaymentStatus = 'pending' | 'held' | 'released' | 'failed';
export type PaymentProvider = 'internal' | 'stripe' | 'lemonway';
export type RatingDirection = 'worker_to_structure' | 'structure_to_worker';
export type ReportMotif = 'absent' | 'conditions' | 'securite' | 'autre';
export type DisputeStatus = 'open' | 'reviewing' | 'resolved' | 'rejected';
export type PayRuleKind =
  | 'day_of_week'
  | 'holiday'
  | 'time_of_day'
  | 'duration'
  | 'sector'
  | 'difficulty'
  | 'urgency'
  | 'distance'
  | 'tension'
  | 'custom';
export type WalletTransactionKind =
  | 'mission_earning'
  | 'bonus'
  | 'mission_charge'
  | 'commission'
  | 'deposit'
  | 'withdrawal'
  | 'adjustment';

export interface PricingAdjustment {
  rule_id: string;
  kind: PayRuleKind;
  label: string;
  amount_cents: number;
}

export interface PricingBreakdown {
  base_cents: number;
  adjustments: PricingAdjustment[];
  total_cents: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: ProfileRole;
          is_micro_entrepreneur: boolean;
          city: string | null;
          phone: string | null;
          birth_date: string | null;
          address: string | null;
          bio: string | null;
          skills: string[];
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string;
          role?: ProfileRole;
          is_micro_entrepreneur?: boolean;
          city?: string | null;
          phone?: string | null;
          birth_date?: string | null;
          address?: string | null;
          bio?: string | null;
          skills?: string[];
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      structures: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          siret: string | null;
          is_ess: boolean;
          about: string | null;
          subscription_active: boolean;
          subscribed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          siret?: string | null;
          is_ess?: boolean;
          about?: string | null;
          subscription_active?: boolean;
          subscribed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['structures']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'structures_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      missions: {
        Row: {
          id: string;
          structure_id: string;
          title: string;
          detail: string | null;
          city: string | null;
          address: string | null;
          lat: number | null;
          lng: number | null;
          distance_km: number | null;
          scheduled_date: string;
          start_time: string | null;
          duration_minutes: number;
          sector: MissionSector;
          difficulty: number;
          is_urgent: boolean;
          worker_rate_cents: number;
          base_rate_cents: number | null;
          pricing_breakdown: PricingBreakdown | null;
          is_solidaire: boolean;
          status: MissionStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          structure_id: string;
          title: string;
          detail?: string | null;
          city?: string | null;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          distance_km?: number | null;
          scheduled_date: string;
          start_time?: string | null;
          duration_minutes: number;
          sector?: MissionSector;
          difficulty?: number;
          is_urgent?: boolean;
          worker_rate_cents: number;
          base_rate_cents?: number | null;
          pricing_breakdown?: PricingBreakdown | null;
          is_solidaire?: boolean;
          status?: MissionStatus;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['missions']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'missions_structure_id_fkey';
            columns: ['structure_id'];
            isOneToOne: false;
            referencedRelation: 'structures';
            referencedColumns: ['id'];
          },
        ];
      };
      applications: {
        Row: {
          id: string;
          mission_id: string;
          worker_id: string;
          status: ApplicationStatus;
          checkin_token: string;
          checked_in_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          mission_id: string;
          worker_id: string;
          status?: ApplicationStatus;
          checkin_token?: string;
          checked_in_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['applications']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'applications_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'applications_worker_id_fkey';
            columns: ['worker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      pay_rules: {
        Row: {
          id: string;
          structure_id: string;
          kind: PayRuleKind;
          label: string;
          params: Json;
          adjust_pct: number;
          adjust_cents: number;
          priority: number;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          structure_id: string;
          kind: PayRuleKind;
          label: string;
          params?: Json;
          adjust_pct?: number;
          adjust_cents?: number;
          priority?: number;
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['pay_rules']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'pay_rules_structure_id_fkey';
            columns: ['structure_id'];
            isOneToOne: false;
            referencedRelation: 'structures';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          application_id: string;
          sender_id: string;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          sender_id: string;
          body: string;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'messages_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_sender_id_fkey';
            columns: ['sender_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          profile_id: string;
          kind: string;
          title: string;
          body: string | null;
          data: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          kind: string;
          title: string;
          body?: string | null;
          data?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'notifications_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      wallets: {
        Row: {
          id: string;
          profile_id: string;
          balance_cents: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          balance_cents?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['wallets']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'wallets_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      wallet_transactions: {
        Row: {
          id: string;
          wallet_id: string;
          amount_cents: number;
          kind: WalletTransactionKind;
          application_id: string | null;
          label: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          wallet_id: string;
          amount_cents: number;
          kind: WalletTransactionKind;
          application_id?: string | null;
          label?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['wallet_transactions']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'wallet_transactions_wallet_id_fkey';
            columns: ['wallet_id'];
            isOneToOne: false;
            referencedRelation: 'wallets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wallet_transactions_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_settings: {
        Row: {
          id: boolean;
          commission_pct: number;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          commission_pct?: number;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['platform_settings']['Insert']>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          application_id: string;
          amount_cents: number;
          worker_amount_cents: number;
          commission_cents: number;
          bonus_cents: number;
          structure_id: string | null;
          worker_id: string | null;
          provider: PaymentProvider;
          released_at: string | null;
          breakdown: PricingBreakdown | null;
          status: PaymentStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          amount_cents: number;
          worker_amount_cents?: number;
          commission_cents?: number;
          bonus_cents?: number;
          structure_id?: string | null;
          worker_id?: string | null;
          provider?: PaymentProvider;
          released_at?: string | null;
          breakdown?: PricingBreakdown | null;
          status?: PaymentStatus;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['payments']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'payments_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: true;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
        ];
      };
      lemonway_accounts: {
        Row: {
          id: string;
          profile_id: string;
          lemonway_wallet_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          lemonway_wallet_id: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['lemonway_accounts']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'lemonway_accounts_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      ratings: {
        Row: {
          id: string;
          application_id: string;
          structure_id: string;
          worker_id: string;
          score: number;
          direction: RatingDirection;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          structure_id: string;
          worker_id: string;
          score: number;
          direction?: RatingDirection;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ratings']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'ratings_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: true;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ratings_structure_id_fkey';
            columns: ['structure_id'];
            isOneToOne: false;
            referencedRelation: 'structures';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ratings_worker_id_fkey';
            columns: ['worker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      delay_notices: {
        Row: {
          id: string;
          application_id: string;
          minutes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          minutes: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['delay_notices']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'delay_notices_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
        ];
      };
      reports: {
        Row: {
          id: string;
          application_id: string;
          worker_id: string;
          motif: ReportMotif;
          note: string | null;
          status: 'open' | 'reviewing' | 'resolved';
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          worker_id: string;
          motif: ReportMotif;
          note?: string | null;
          status?: 'open' | 'reviewing' | 'resolved';
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['reports']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'reports_application_id_fkey';
            columns: ['application_id'];
            isOneToOne: false;
            referencedRelation: 'applications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_worker_id_fkey';
            columns: ['worker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reliability_disputes: {
        Row: {
          id: string;
          worker_id: string;
          description: string;
          status: DisputeStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          worker_id: string;
          description: string;
          status?: DisputeStatus;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['reliability_disputes']['Insert']>;
        Relationships: [
          {
            foreignKeyName: 'reliability_disputes_worker_id_fkey';
            columns: ['worker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      reliability_index: {
        Row: {
          worker_id: string | null;
          accepted_count: number;
          rejected_count: number;
          cancelled_count: number;
          total_applications: number;
          reliability_score: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      compute_mission_pricing: {
        Args: {
          p_structure_id: string;
          p_base_cents: number;
          p_date: string;
          p_start_time?: string | null;
          p_duration_minutes?: number;
          p_sector?: string;
          p_difficulty?: number;
          p_urgent?: boolean;
          p_distance_km?: number | null;
        };
        Returns: Json;
      };
      deposit_wallet: {
        Args: { p_amount_cents: number; p_label?: string };
        Returns: number;
      };
      withdraw_wallet: {
        Args: { p_amount_cents: number };
        Returns: number;
      };
      subscribe_structure: {
        Args: { p_structure_id: string };
        Returns: undefined;
      };
      structure_stats: {
        Args: { p_structure_id: string };
        Returns: Json;
      };
      worker_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      worker_cv: {
        Args: { p_worker_id: string };
        Returns: Json;
      };
      process_mission_payment: {
        Args: { p_application_id: string };
        Returns: string | null;
      };
      is_french_holiday: {
        Args: { p_date: string };
        Returns: boolean;
      };
    };
  };
}
