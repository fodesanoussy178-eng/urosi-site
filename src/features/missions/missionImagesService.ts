// Photos des missions natives UROSI (table public.mission_images + bucket
// mission-images). Une photo est TOUJOURS un fichier téléversé par la
// structure dans son propre dossier, droits attestés par elle : jamais une
// URL copiée d'un site tiers (la base le refuse, voir migration 20260927120000).
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type MissionImage = Database['public']['Tables']['mission_images']['Row'];

export const MISSION_IMAGES_BUCKET = 'mission-images';
export const MAX_OPTIONAL_IMAGES = 5;
export const MAX_MISSION_IMAGES = 1 + MAX_OPTIONAL_IMAGES;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const RIGHTS_ATTESTATION =
  'Je certifie que la structure dispose des droits sur ces photos (prises par elle ou avec autorisation) et que les personnes reconnaissables ont donné leur accord.';

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Format accepté : JPG, PNG ou WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'Photo trop lourde (5 Mo maximum).';
  return null;
}

function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '');
}

function extensionOf(file: File): string {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

// Images d'une mission, principale d'abord (lecture publique si la mission
// est publiée, ou par sa structure).
export async function fetchMissionImages(missionId: string): Promise<MissionImage[]> {
  const { data, error } = await supabase
    .from('mission_images')
    .select('*')
    .eq('mission_id', missionId)
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (isMissingRelation(error)) return [];
  if (error) throw error;
  return (data ?? []) as MissionImage[];
}

// Photo principale de plusieurs missions (fil connecté).
export async function fetchPrimaryImages(missionIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (missionIds.length === 0) return result;
  const { data, error } = await supabase
    .from('mission_images')
    .select('mission_id, image_url, is_primary, position')
    .in('mission_id', missionIds.slice(0, 300))
    .neq('rights_status', 'unknown')
    .order('is_primary', { ascending: false })
    .order('position', { ascending: true });
  if (isMissingRelation(error)) return result;
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ mission_id: string | null; image_url: string }>) {
    if (row.mission_id && !result.has(row.mission_id)) result.set(row.mission_id, row.image_url);
  }
  return result;
}

export interface UploadContext {
  structureId: string;
  missionId: string;
  userId: string;
}

export async function uploadMissionImage(ctx: UploadContext, file: File, options: { isPrimary: boolean; position: number }): Promise<MissionImage> {
  const invalid = validateImageFile(file);
  if (invalid) throw new Error(invalid);
  const path = `${ctx.structureId}/${ctx.missionId}/${crypto.randomUUID()}.${extensionOf(file)}`;
  const storage = supabase.storage.from(MISSION_IMAGES_BUCKET);
  const { error: uploadError } = await storage.upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (uploadError) throw uploadError;
  const { data: publicUrl } = storage.getPublicUrl(path);
  const { data, error } = await supabase
    .from('mission_images')
    .insert({
      mission_id: ctx.missionId,
      image_url: publicUrl.publicUrl,
      storage_path: path,
      source: 'structure_upload',
      rights_status: 'authorized',
      rights_attested_by: ctx.userId,
      rights_attested_at: new Date().toISOString(),
      created_by: ctx.userId,
      is_primary: options.isPrimary,
      position: Math.max(0, Math.min(options.position, MAX_OPTIONAL_IMAGES)),
    })
    .select('*')
    .single();
  if (error) {
    // Pas de fichier orphelin si l'enregistrement est refusé.
    await storage.remove([path]).catch(() => undefined);
    throw error;
  }
  return data as MissionImage;
}

export async function setPrimaryMissionImage(imageId: string): Promise<void> {
  const { error } = await supabase.rpc('set_mission_primary_image', { p_image_id: imageId });
  if (error) throw error;
}

// Suppression : la ligne puis le fichier. Si c'était la photo principale,
// la suivante prend le relais (jamais de mission sans principale s'il reste
// des photos).
export async function deleteMissionImage(image: MissionImage): Promise<void> {
  const { error } = await supabase.from('mission_images').delete().eq('id', image.id);
  if (error) throw error;
  if (image.storage_path) await supabase.storage.from(MISSION_IMAGES_BUCKET).remove([image.storage_path]).catch(() => undefined);
  if (image.is_primary && image.mission_id) {
    const remaining = await fetchMissionImages(image.mission_id);
    if (remaining[0]) await setPrimaryMissionImage(remaining[0].id);
  }
}

// Remplacement : nouvelle photo à la même place, puis retrait de l'ancienne.
export async function replaceMissionImage(ctx: UploadContext, image: MissionImage, file: File): Promise<MissionImage> {
  const created = await uploadMissionImage(ctx, file, { isPrimary: false, position: image.position });
  const { error } = await supabase.from('mission_images').delete().eq('id', image.id);
  if (error) throw error;
  if (image.storage_path) await supabase.storage.from(MISSION_IMAGES_BUCKET).remove([image.storage_path]).catch(() => undefined);
  if (image.is_primary) {
    await setPrimaryMissionImage(created.id);
    return { ...created, is_primary: true };
  }
  return created;
}

// Publication : photos choisies dans le formulaire, la première est la principale.
export async function uploadDraftImages(ctx: UploadContext, files: File[]): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const [index, file] of files.slice(0, MAX_MISSION_IMAGES).entries()) {
    try {
      await uploadMissionImage(ctx, file, { isPrimary: uploaded === 0, position: index });
      uploaded++;
    } catch {
      failed++;
    }
  }
  return { uploaded, failed };
}
