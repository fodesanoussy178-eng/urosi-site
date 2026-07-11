import { supabase } from '@/lib/supabase';
import type { AttendanceEventType, AttendanceMethod, Database, MissionReportSeverity, QRTokenType } from '@/types/database.types';

export type AttendanceEvent = Database['public']['Tables']['attendance_events']['Row'];

export interface CreatedAttendanceQR {
  token: string;
  expires_at: string;
}

export interface ScanContext {
  state:
    | 'valid'
    | 'invalid'
    | 'expired'
    | 'used'
    | 'not_authorized'
    | 'missing_start'
    | 'already_started'
    | 'already_ended'
    | 'confirmed';
  type?: QRTokenType;
  expires_at?: string;
  application_id?: string;
  mission_id?: string;
  mission_title?: string;
  city?: string | null;
  scheduled_date?: string;
  start_time?: string | null;
  duration_minutes?: number;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  delay_minutes?: number;
  delay_status?: string;
  worker_name?: string;
  structure_name?: string;
  current_time?: string;
  confirmed_at?: string;
}

function asObject<T>(value: unknown): T {
  return (value ?? {}) as T;
}

export async function createAttendanceQR(applicationId: string, type: QRTokenType): Promise<CreatedAttendanceQR> {
  const { data, error } = await supabase.rpc('create_mission_qr_token', {
    p_application_id: applicationId,
    p_type: type,
  });
  if (error) throw error;
  return asObject<CreatedAttendanceQR>(data);
}

export async function fetchScanContext(token: string): Promise<ScanContext> {
  const { data, error } = await supabase.rpc('get_scan_context', { p_token: token });
  if (error) throw error;
  return asObject<ScanContext>(data);
}

export async function confirmAttendanceQR(token: string): Promise<ScanContext> {
  const { data, error } = await supabase.rpc('confirm_attendance_qr', { p_token: token });
  if (error) throw error;
  return asObject<ScanContext>(data);
}

export async function requestRemoteAttendance(applicationId: string, type: QRTokenType, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('request_remote_attendance', {
    p_application_id: applicationId,
    p_type: type,
    p_reason: reason || null,
  });
  if (error) throw error;
}

export async function confirmRemoteAttendance(applicationId: string, type: QRTokenType): Promise<void> {
  const { error } = await supabase.rpc('confirm_remote_attendance', {
    p_application_id: applicationId,
    p_type: type,
  });
  if (error) throw error;
}

export async function reportWorkerDelay(input: {
  applicationId: string;
  minutes: number;
  reason?: string;
  eta?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('report_worker_delay', {
    p_application_id: input.applicationId,
    p_minutes: input.minutes,
    p_reason: input.reason || null,
    p_eta: input.eta || null,
  });
  if (error) throw error;
}

export async function reportMissionIssue(input: {
  applicationId: string;
  category: string;
  description?: string;
  severity?: MissionReportSeverity;
  reportedUserId?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('report_mission_issue', {
    p_application_id: input.applicationId,
    p_category: input.category,
    p_description: input.description || null,
    p_severity: input.severity ?? 'medium',
    p_reported_user_id: input.reportedUserId ?? null,
  });
  if (error) throw error;
}

export async function reportWorkerAbsence(applicationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('report_worker_absence', {
    p_application_id: applicationId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function fetchAttendanceEvents(applicationIds: string[]): Promise<Map<string, AttendanceEvent[]>> {
  if (applicationIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('attendance_events')
    .select('*')
    .in('application_id', applicationIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const map = new Map<string, AttendanceEvent[]>();
  for (const event of data ?? []) {
    map.set(event.application_id, [...(map.get(event.application_id) ?? []), event]);
  }
  return map;
}

export function attendanceEventLabel(event: Pick<AttendanceEvent, 'event_type' | 'method'>): string {
  const typeLabels: Record<AttendanceEventType, string> = {
    start_requested: 'QR de debut genere',
    start_confirmed: 'Debut confirme',
    end_requested: 'QR de fin genere',
    end_confirmed: 'Fin confirmee',
    delay_reported: 'Retard signale',
    delay_confirmed: 'Retard constate',
    absence_reported: 'Absence signalee',
    absence_confirmed: 'Absence confirmee',
    issue_reported: 'Probleme signale',
    remote_requested: 'Validation a distance demandee',
    paper_submitted: 'Attestation papier envoyee',
  };
  const methodLabels: Record<AttendanceMethod, string> = {
    qr: 'QR',
    remote: 'distance',
    paper: 'papier',
    support: 'Support UROSI',
  };
  return `${typeLabels[event.event_type]} (${methodLabels[event.method]})`;
}
