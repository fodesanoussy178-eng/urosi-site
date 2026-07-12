export function normalizeSiret(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 14);
}

export function formatSiret(value: string | null | undefined): string {
  const digits = normalizeSiret(value);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), digits.slice(9)].filter(Boolean).join(' ');
}

export function isValidSiret(value: string | null | undefined): boolean {
  const digits = normalizeSiret(value);
  if (digits.length !== 14) return false;

  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}
