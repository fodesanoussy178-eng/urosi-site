// CV UROSI au format PDF. jsPDF n'est chargé qu'au clic sur « Télécharger
// mon CV ». Polices standard (Helvetica, encodage WinAnsi) : les accents
// français passent, les émojis sont exclus du document.
import { formatEngagementHours, type Experience, type JourneySummary } from './journey';

export interface CvIdentity {
  name: string;
  city: string | null;
  bio: string | null;
}

function day(date: string | null): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function hours(minutes: number | null): string {
  return minutes ? formatEngagementHours(minutes) : '';
}

// Retire ce que Helvetica/WinAnsi ne sait pas dessiner (émojis, symboles).
function safe(text: string): string {
  return text.replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u20AC\u0152\u0153\n]/g, '').trim();
}

export async function downloadCvPdf(identity: CvIdentity, summary: JourneySummary, experiences: Experience[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  let y = 20;

  const ensure = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 20;
    }
  };
  const text = (value: string, x: number, size: number, style: 'normal' | 'bold' = 'normal', color: [number, number, number] = [23, 35, 40]) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(safe(value), x, y);
  };
  const paragraph = (value: string, size: number, color: [number, number, number] = [83, 99, 106], width = W - 2 * M) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(safe(value), width) as string[];
    for (const line of lines) {
      ensure(5);
      doc.text(line, M, y);
      y += size * 0.45;
    }
  };
  const section = (title: string) => {
    ensure(14);
    y += 4;
    text(title.toUpperCase(), M, 9.5, 'bold', [8, 127, 154]);
    y += 2;
    doc.setDrawColor(216, 224, 228);
    doc.line(M, y, W - M, y);
    y += 6;
  };

  // En-tête
  doc.setFillColor(8, 145, 178);
  doc.rect(0, 0, W, 6, 'F');
  text(identity.name, M, 22, 'bold');
  y += 7;
  text([identity.city, 'Parcours UROSI'].filter(Boolean).join(' · '), M, 10.5, 'normal', [83, 99, 106]);
  y += 6;
  if (identity.bio) {
    paragraph(identity.bio, 10);
    y += 1;
  }

  // Chiffres (vérifiés uniquement)
  section('En bref');
  const facts: Array<[string, string]> = [
    [String(summary.missions), summary.missions > 1 ? 'missions vérifiées' : 'mission vérifiée'],
    [formatEngagementHours(summary.minutes), "d'engagement vérifié"],
    [String(summary.structures), summary.structures > 1 ? 'structures' : 'structure'],
    [summary.reviewsReceived ? `${summary.averageReceived?.toFixed(1).replace('.', ',')}/5` : '-', `${summary.reviewsReceived} avis reçu${summary.reviewsReceived > 1 ? 's' : ''}`],
  ];
  const colW = (W - 2 * M) / facts.length;
  facts.forEach(([value, label], i) => {
    const x = M + i * colW;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(23, 35, 40);
    doc.text(safe(value), x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(118, 133, 139);
    doc.text(safe(label), x, y + 5);
  });
  y += 12;

  if (summary.domains.length > 0) {
    section('Domaines explorés');
    paragraph(summary.domains.map((d) => `${d.label} (${d.count})`).join('   ·   '), 10, [23, 35, 40]);
  }
  if (summary.skills.length > 0) {
    section('Compétences mobilisées');
    paragraph(summary.skills.join('   ·   '), 10, [23, 35, 40]);
  }

  const writeExperience = (e: Experience) => {
    ensure(24);
    text(e.title, M, 11.5, 'bold');
    if (e.verified) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(21, 128, 61);
      doc.text('EXPÉRIENCE VÉRIFIÉE', W - M, y, { align: 'right' });
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(118, 133, 139);
      doc.text('déclarée, en attente de vérification', W - M, y, { align: 'right' });
    }
    y += 5;
    paragraph([e.organization, day(e.date), hours(e.minutes), e.city ?? ''].filter(Boolean).join('  ·  '), 9.5);
    if (e.skills.length) paragraph(`Compétences : ${e.skills.join(', ')}`, 9, [83, 99, 106]);
    if (e.structureComment) paragraph(`« ${e.structureComment} » — ${e.organization}`, 9, [23, 35, 40]);
    y += 3;
  };

  const verified = experiences.filter((e) => e.verified);
  const declared = experiences.filter((e) => !e.verified);
  section('Expériences vérifiées');
  if (verified.length === 0) paragraph('Les expériences vérifiées apparaîtront ici après tes premières missions.', 9.5);
  verified.forEach(writeExperience);
  if (declared.length > 0) {
    section('Expériences déclarées');
    paragraph('Missions déclarées par la personne, pas encore vérifiées par UROSI.', 8.5, [118, 133, 139]);
    y += 1;
    declared.forEach(writeExperience);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(135, 147, 151);
    doc.text(`CV UROSI · généré le ${new Date().toLocaleDateString('fr-FR')}`, M, 290);
    doc.text(`${p}/${pages}`, W - M, 290, { align: 'right' });
  }

  const fileName = `CV-UROSI-${identity.name.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'parcours'}.pdf`;
  doc.save(fileName);
}
