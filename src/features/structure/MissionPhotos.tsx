// Photos d'une mission UROSI côté structure : 1 photo principale + jusqu'à 5
// facultatives, aperçu avant publication, suppression et remplacement.
// Les fichiers sont téléversés dans le dossier de la structure ; aucune URL
// externe n'est acceptée (droits attestés par la structure).
import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/ui/theme';
import {
  MAX_MISSION_IMAGES,
  RIGHTS_ATTESTATION,
  deleteMissionImage,
  fetchMissionImages,
  replaceMissionImage,
  setPrimaryMissionImage,
  uploadMissionImage,
  validateImageFile,
  type MissionImage,
  type UploadContext,
} from '@/features/missions/missionImagesService';

export interface DraftPhoto {
  id: string;
  file: File;
  url: string;
}

interface TileProps {
  url: string;
  primary: boolean;
  index: number;
  busy?: boolean;
  onMakePrimary?: () => void;
  onReplace: () => void;
  onRemove: () => void;
}

function PhotoTile({ url, primary, index, busy, onMakePrimary, onReplace, onRemove }: TileProps) {
  const small = { background: 'rgba(255,255,255,.92)', color: '#0f1f3a', border: 'none', borderRadius: 7, padding: '4px 7px', fontSize: 10, fontWeight: 800, cursor: busy ? 'wait' : 'pointer' } as const;
  const icon = { ...small, width: 24, height: 24, padding: 0, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <div
      style={{ position: 'relative', gridColumn: primary ? '1 / -1' : undefined, aspectRatio: primary ? '16 / 9' : '4 / 3', borderRadius: 12, overflow: 'hidden', background: T.row, border: `1px solid ${primary ? T.cyan : T.cb}`, opacity: busy ? 0.6 : 1 }}
    >
      <img src={url} alt={primary ? 'Aperçu de la photo principale' : `Aperçu de la photo ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {primary && (
        <span style={{ position: 'absolute', top: 8, left: 8, background: T.cyan, color: '#fff', fontSize: 10, fontWeight: 900, borderRadius: 999, padding: '3px 9px' }}>Photo principale</span>
      )}
      <div style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', gap: 5 }}>
        {!primary && onMakePrimary && (
          <button type="button" disabled={busy} onClick={onMakePrimary} style={primary ? small : icon} title="Choisir comme photo principale" aria-label={`Choisir la photo ${index + 1} comme principale`}>
            ★
          </button>
        )}
        <button type="button" disabled={busy} onClick={onReplace} style={primary ? small : icon} title="Remplacer" aria-label={`Remplacer la photo ${index + 1}`}>
          {primary ? 'Remplacer' : '↻'}
        </button>
        <button type="button" disabled={busy} onClick={onRemove} style={{ ...(primary ? small : icon), color: '#c0262d' }} title="Supprimer" aria-label={`Supprimer la photo ${index + 1}`}>
          {primary ? 'Supprimer' : '✕'}
        </button>
      </div>
    </div>
  );
}

function AddTile({ count, onAdd, disabled }: { count: number; onAdd: () => void; disabled?: boolean }) {
  const first = count === 0;
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      style={{ gridColumn: first ? '1 / -1' : undefined, aspectRatio: first ? '16 / 7' : '4 / 3', borderRadius: 12, border: `1.5px dashed ${T.cb}`, background: T.row, color: T.sub, fontSize: 11.5, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 10, opacity: disabled ? 0.6 : 1 }}
    >
      <span style={{ fontSize: 20 }}>＋</span>
      {first ? 'Ajouter une photo principale' : `Ajouter une photo (${count}/${MAX_MISSION_IMAGES})`}
      {first && <span style={{ fontSize: 10, fontWeight: 600, color: T.mu }}>JPG, PNG ou WebP · 5 Mo max · facultatif</span>}
    </button>
  );
}

function useFilePicker(onPick: (file: File, target: string | null) => void) {
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      aria-label="Choisir une photo"
      style={{ display: 'none' }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onPick(file, target.current);
      }}
    />
  );
  const open = (forTarget: string | null) => {
    target.current = forTarget;
    input.current?.click();
  };
  return { element, open };
}

function Attestation({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 10.5, color: T.sub, lineHeight: 1.5, cursor: 'pointer', marginTop: 8 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      {RIGHTS_ATTESTATION}
    </label>
  );
}

// Formulaire de publication : photos gardées en mémoire (aperçu) jusqu'à la
// publication, la première étant la photo principale.
export function MissionPhotosDraft({
  value,
  onChange,
  attested,
  onAttestedChange,
}: {
  value: DraftPhoto[];
  onChange: (next: DraftPhoto[]) => void;
  attested: boolean;
  onAttestedChange: (v: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const picker = useFilePicker((file, target) => {
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    const photo: DraftPhoto = { id: crypto.randomUUID(), file, url: URL.createObjectURL(file) };
    if (target) {
      const old = value.find((p) => p.id === target);
      if (old) URL.revokeObjectURL(old.url);
      onChange(value.map((p) => (p.id === target ? photo : p)));
    } else if (value.length < MAX_MISSION_IMAGES) {
      onChange([...value, photo]);
    }
  });

  return (
    <div>
      {picker.element}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
        {value.map((p, i) => (
          <PhotoTile
            key={p.id}
            url={p.url}
            primary={i === 0}
            index={i}
            onMakePrimary={() => onChange([p, ...value.filter((x) => x.id !== p.id)])}
            onReplace={() => picker.open(p.id)}
            onRemove={() => {
              URL.revokeObjectURL(p.url);
              onChange(value.filter((x) => x.id !== p.id));
            }}
          />
        ))}
        {value.length < MAX_MISSION_IMAGES && <AddTile count={value.length} onAdd={() => picker.open(null)} />}
      </div>
      {value.length === 0 && (
        <div style={{ fontSize: 10, color: T.mu, marginTop: 6, lineHeight: 1.5 }}>Sans photo, la mission s'affiche avec votre logo ou une illustration UROSI.</div>
      )}
      {value.length > 0 && <Attestation checked={attested} onChange={onAttestedChange} />}
      {error && <div style={{ fontSize: 10.5, color: T.red, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// Mission déjà publiée : chaque action est enregistrée immédiatement.
export function MissionPhotosManager({ ctx }: { ctx: UploadContext }) {
  const [images, setImages] = useState<MissionImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setImages(await fetchMissionImages(ctx.missionId).catch(() => []));
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.missionId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message || 'Action impossible pour le moment.');
    } finally {
      await reload();
      setBusy(false);
    }
  }

  const picker = useFilePicker((file, target) => {
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!attested) {
      setError('Cochez l’attestation de droits avant d’ajouter une photo.');
      return;
    }
    const list = images ?? [];
    const old = target ? list.find((i) => i.id === target) : undefined;
    void run(() =>
      old
        ? replaceMissionImage(ctx, old, file)
        : uploadMissionImage(ctx, file, { isPrimary: list.length === 0, position: Math.min(list.length, MAX_MISSION_IMAGES - 1) }),
    );
  });

  if (images === null) return <div style={{ fontSize: 11, color: T.mu }}>Chargement des photos…</div>;

  return (
    <div>
      {picker.element}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
        {images.map((img, i) => (
          <PhotoTile
            key={img.id}
            url={img.image_url}
            primary={img.is_primary || (i === 0 && !images.some((x) => x.is_primary))}
            index={i}
            busy={busy}
            onMakePrimary={() => void run(() => setPrimaryMissionImage(img.id))}
            onReplace={() => picker.open(img.id)}
            onRemove={() => void run(() => deleteMissionImage(img))}
          />
        ))}
        {images.length < MAX_MISSION_IMAGES && <AddTile count={images.length} onAdd={() => picker.open(null)} disabled={busy} />}
      </div>
      <Attestation checked={attested} onChange={setAttested} />
      {error && <div style={{ fontSize: 10.5, color: T.red, marginTop: 6 }}>{error}</div>}
    </div>
  );
}
