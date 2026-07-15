import { supabase } from '@/lib/supabase';

export type AccountStatus = 'active' | 'suspended';

export interface FounderDashboard {
  users: number;
  structures: number;
  missions_published: number;
  missions_in_progress: number;
  missions_completed: number;
  applications: number;
  reports_pending: number;
  kyc_pending: number;
  aal: string;
  mfa_required: boolean;
}

export interface FounderProfileAccount {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  account_status: AccountStatus;
  suspended_until: string | null;
  suspension_reason: string | null;
  kyc_status: string;
  history_count: number;
  created_at: string;
}

export interface FounderStructureAccount {
  id: string;
  owner_id: string;
  name: string;
  email: string | null;
  account_status: AccountStatus;
  verification_status: string;
  history_count: number;
  created_at: string;
}

export interface FounderAccounts {
  profiles: FounderProfileAccount[];
  structures: FounderStructureAccount[];
}

export interface FounderMission {
  id: string;
  title: string;
  status: string;
  structure_name: string;
  scheduled_date: string;
  category: string;
  amount: number;
  participants: number;
  created_at: string;
}

export interface FounderReportAction {
  id: number;
  action: string;
  note: string | null;
  created_at: string;
}

export interface FounderReport {
  id: string;
  category: string;
  description: string | null;
  severity: string;
  status: string;
  created_at: string;
  reported_user_id: string | null;
  structure_id: string;
  mission_title: string;
  reporter_name: string;
  target_name: string;
  history: FounderReportAction[];
}

export interface FounderRevenue {
  generated_cents: number;
  pending_cents: number;
  month_cents: number;
  lifetime_cents: number;
  simulated_cents: number;
  confirmed_cents: number;
  simulated: boolean;
}

export interface FounderAuditEntry {
  id: number;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  metadata: Record<string, unknown>;
  actor_name: string;
  created_at: string;
}

export interface LabScenario {
  id: string;
  entity_type: string;
  label: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface FounderLabStatus {
  environment: 'production' | 'staging';
  enabled: boolean;
  scenarios: LabScenario[];
}

export interface AccountHistory {
  worker_missions: Array<Record<string, unknown>>;
  structure_missions: Array<Record<string, unknown>>;
  admin_actions: Array<Record<string, unknown>>;
}

type RpcResponse = PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => RpcResponse;

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const founderAdminApi = {
  dashboard: () => call<FounderDashboard>('founder_admin_dashboard'),
  accounts: (search = '') => call<FounderAccounts>('founder_admin_accounts', { p_search: search }),
  accountHistory: (profileId: string) => call<AccountHistory>('founder_admin_account_history', { p_profile_id: profileId }),
  setAccountStatus: (profileId: string, status: AccountStatus, reason?: string, suspendedUntil?: string) =>
    call<void>('founder_admin_set_account_status', {
      p_profile_id: profileId,
      p_status: status,
      p_reason: reason ?? null,
      p_suspended_until: suspendedUntil ?? null,
    }),
  missions: (search = '', status = '') => call<FounderMission[]>('founder_admin_missions', { p_search: search, p_status: status }),
  setMissionStatus: (missionId: string, status: string, reason: string) =>
    call<void>('founder_admin_set_mission_status', { p_mission_id: missionId, p_status: status, p_reason: reason }),
  reports: (status = '') => call<FounderReport[]>('founder_admin_reports', { p_status: status }),
  actOnReport: (reportId: string, action: string, note?: string, suspendedUntil?: string) =>
    call<void>('founder_admin_act_on_report', {
      p_report_id: reportId,
      p_action: action,
      p_note: note ?? null,
      p_suspended_until: suspendedUntil ?? null,
    }),
  revenue: () => call<FounderRevenue>('founder_admin_revenue'),
  auditLog: () => call<FounderAuditEntry[]>('founder_admin_audit_log', { p_limit: 200 }),
  requestKycDocument: (profileId: string, reason: string) =>
    call<void>('founder_admin_request_kyc_document', { p_profile_id: profileId, p_reason: reason }),
  labStatus: () => call<FounderLabStatus>('founder_admin_lab_status'),
  createLabScenario: (entityType: string) => call<LabScenario>('founder_admin_lab_create', { p_entity_type: entityType }),
};
