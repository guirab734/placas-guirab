// Four handwritten characters, without 0/O, 1/I or L. The first character is always a letter.
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const ALPHABET = `${LETTERS}23456789`;
export const SHORT_CODE = /^[A-HJKMNP-Z][A-HJKMNP-Z2-9]{3}$/;

function randomIndex(length: number): number {
  const cutoff = 256 - (256 % length);
  const byte = new Uint8Array(1);
  do { crypto.getRandomValues(byte); } while (byte[0] >= cutoff);
  return byte[0] % length;
}

export function shortPlateCode(): string {
  let code: string;
  do {
    code = LETTERS[randomIndex(LETTERS.length)];
    for (let i = 0; i < 3; i++) code += ALPHABET[randomIndex(ALPHABET.length)];
  } while (!/[2-9]/.test(code));
  return code;
}

export async function availablePlateCodes(database: D1Database, quantity: number): Promise<string[]> {
  const result = await database.prepare(`SELECT code FROM lojas UNION SELECT code FROM plate_code_aliases
    UNION SELECT legacy_code AS code FROM lojas WHERE legacy_code IS NOT NULL`).all<{ code: string }>();
  const used = new Set(result.results.map(row => row.code.toUpperCase()));
  const codes: string[] = [];
  for (let attempts = 0; codes.length < quantity && attempts < quantity * 100; attempts++) {
    const code = shortPlateCode();
    if (!used.has(code)) { used.add(code); codes.push(code); }
  }
  if (codes.length !== quantity) throw new Error("Unable to allocate plate codes");
  return codes;
}

export function codeCollision(error: unknown): boolean {
  for (let depth = 0; depth < 4 && error instanceof Error; depth++, error = error.cause) {
    if (/UNIQUE constraint failed: (?:lojas\.code|plate_code_aliases\.code)|plate code collision/i.test(error.message)) return true;
  }
  return false;
}

export function normalizePlateCode(code: string): string | null {
  if (SHORT_CODE.test(code.toUpperCase())) return code.toUpperCase();
  if (/^[a-f0-9]{16}$/i.test(code)) return code.toLowerCase();
  return /^[1-9][0-9]{0,8}$/.test(code) ? code : null;
}
