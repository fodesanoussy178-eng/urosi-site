/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_KYC_MODE?: 'simulation' | 'external';
  // Phase 0 : couche rémunérée et pointage QR en sommeil (défaut false).
  readonly VITE_FEATURE_PAID_LAYER?: string;
  readonly VITE_FEATURE_QR_ATTENDANCE?: string;
  // Missions d'exemple quand le catalogue public est vide (défaut : actif).
  readonly VITE_DEMO_MISSIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
