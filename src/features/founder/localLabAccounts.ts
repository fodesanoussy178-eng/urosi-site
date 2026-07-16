export type LocalLabAccountRole = 'worker' | 'structure';

export interface LocalLabAccount {
  id: string;
  name: string;
  role: LocalLabAccountRole;
  createdAt: string;
}

const LOCAL_LAB_ACCOUNTS_KEY = 'urosi_founder_local_lab_accounts_v1';

export function readLocalLabAccounts(): LocalLabAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_LAB_ACCOUNTS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is LocalLabAccount => Boolean(
      row
      && typeof row === 'object'
      && typeof (row as LocalLabAccount).id === 'string'
      && typeof (row as LocalLabAccount).name === 'string'
      && ['worker', 'structure'].includes((row as LocalLabAccount).role),
    ));
  } catch {
    return [];
  }
}

export function createLocalLabAccount(name: string, role: LocalLabAccountRole): LocalLabAccount {
  const cleanName = name.trim();
  if (cleanName.length < 2) throw new Error('Ajoute un nom de deux caractères minimum.');
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const account: LocalLabAccount = { id, name: cleanName, role, createdAt: new Date().toISOString() };
  const accounts = [account, ...readLocalLabAccounts()].slice(0, 20);
  localStorage.setItem(LOCAL_LAB_ACCOUNTS_KEY, JSON.stringify(accounts));
  return account;
}

export function removeLocalLabAccount(id: string): LocalLabAccount[] {
  const accounts = readLocalLabAccounts().filter((account) => account.id !== id);
  localStorage.setItem(LOCAL_LAB_ACCOUNTS_KEY, JSON.stringify(accounts));
  return accounts;
}

export function findLocalLabAccount(id: string | null): LocalLabAccount | null {
  if (!id) return null;
  return readLocalLabAccounts().find((account) => account.id === id) ?? null;
}
