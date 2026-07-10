import type { Database } from '@/types/database.types';

export type Mission = Database['public']['Tables']['missions']['Row'];
export type MissionInsert = Database['public']['Tables']['missions']['Insert'];
export type Structure = Database['public']['Tables']['structures']['Row'];
