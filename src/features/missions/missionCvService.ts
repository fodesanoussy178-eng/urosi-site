import { supabase } from '@/lib/supabase';

// Entree CV vivant : trois points (pending_verification) -> vert (verified)
// une fois verifiee automatiquement (J+2, cf. edge function
// release-internal-payments) ou validee plus tot par la structure.
export async function verifyMissionCvEntry(applicationId: string): Promise<void> {
  const { error } = await supabase.rpc('verify_mission_cv_entry', { p_application_id: applicationId });
  if (error) throw error;
}

export async function disputeMissionCvEntry(applicationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('dispute_mission_cv_entry', { p_application_id: applicationId, p_reason: reason });
  if (error) throw error;
}
