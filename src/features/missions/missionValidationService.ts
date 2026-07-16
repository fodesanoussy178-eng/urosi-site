import { supabase } from '@/lib/supabase';

export type ValidationStep = 'start' | 'end';

export interface MissionValidationCard {
  mission_id: string;
  structure_id: string;
  structure_name: string;
  title: string;
  city: string | null;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_date: string;
  mission_code: string;
  qr_code: string;
}

export interface ActiveMissionPin {
  state: 'active' | 'not_today';
  pin?: string;
  step?: ValidationStep;
  expires_at?: string;
  server_time?: string;
  first_day?: string;
  last_day?: string;
}

export interface WorkerValidationContext {
  state: 'ready' | 'not_found' | 'already_ended';
  step?: ValidationStep;
  mission_id?: string;
  application_id?: string;
  title?: string;
  city?: string | null;
  structure_name?: string;
  mission_code?: string;
}

export interface ValidationResult {
  state:
    | 'confirmed'
    | 'invalid_step'
    | 'manual_reason_required'
    | 'invalid_identifier'
    | 'application_not_found'
    | 'locked'
    | 'invalid_attendance_state'
    | 'pin_expired'
    | 'invalid_pin';
  step?: ValidationStep;
  confirmed_at?: string;
  remaining_attempts?: number;
  retry_after_seconds?: number;
}

export interface StructureValidator {
  user_id: string;
  full_name: string;
  email: string;
  created_at: string;
}

function object<T>(value: unknown): T {
  return (value ?? {}) as T;
}

export async function listValidatorMissions(): Promise<MissionValidationCard[]> {
  const { data, error } = await supabase.rpc('list_validator_missions');
  if (error) throw error;
  return (data ?? []) as MissionValidationCard[];
}

export async function getMissionValidationCard(missionId: string): Promise<MissionValidationCard> {
  const { data, error } = await supabase.rpc('get_mission_validation_card', { p_mission_id: missionId });
  if (error) throw error;
  return object<MissionValidationCard>(data);
}

export async function issueMissionPin(missionId: string, step: ValidationStep): Promise<ActiveMissionPin> {
  const { data, error } = await supabase.rpc('issue_mission_validation_pin', { p_mission_id: missionId, p_step: step });
  if (error) throw error;
  return object<ActiveMissionPin>(data);
}

export async function getWorkerValidationContext(input: {
  qrCode?: string | null;
  missionCode?: string | null;
}): Promise<WorkerValidationContext> {
  const { data, error } = await supabase.rpc('get_worker_validation_context', {
    p_qr_code: input.qrCode ?? null,
    p_mission_code: input.missionCode ?? null,
  });
  if (error) throw error;
  return object<WorkerValidationContext>(data);
}

export async function validateMissionAttendance(input: {
  qrCode?: string | null;
  missionCode?: string | null;
  pin: string;
  step: ValidationStep;
  manualReason?: string | null;
}): Promise<ValidationResult> {
  const { data, error } = await supabase.rpc('validate_mission_attendance', {
    p_qr_code: input.qrCode ?? null,
    p_mission_code: input.missionCode ?? null,
    p_pin: input.pin,
    p_step: input.step,
    p_manual_reason: input.manualReason ?? null,
  });
  if (error) throw error;
  return object<ValidationResult>(data);
}

export async function listStructureValidators(structureId: string): Promise<StructureValidator[]> {
  const { data, error } = await supabase.rpc('list_structure_validators', { p_structure_id: structureId });
  if (error) throw error;
  return (data ?? []) as StructureValidator[];
}

export async function addStructureValidator(structureId: string, email: string): Promise<{ state: 'added' | 'account_not_found' }> {
  const { data, error } = await supabase.rpc('add_structure_attendance_validator', { p_structure_id: structureId, p_email: email });
  if (error) throw error;
  return object<{ state: 'added' | 'account_not_found' }>(data);
}

export async function removeStructureValidator(structureId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_structure_attendance_validator', { p_structure_id: structureId, p_user_id: userId });
  if (error) throw error;
}
