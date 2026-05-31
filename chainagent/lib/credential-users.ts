import bcrypt from "bcryptjs";

export type CredentialUser = {
  email: string;
  passwordHash: string;
  name?: string;
};

function loadUsersFromEnv(): CredentialUser[] {
  const users: CredentialUser[] = [];

  const json = process.env.AUTH_EMAIL_USERS;
  if (json) {
    try {
      const parsed = JSON.parse(json) as CredentialUser[];
      if (Array.isArray(parsed)) {
        for (const u of parsed) {
          if (u.email && u.passwordHash) users.push(u);
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const email = process.env.AUTH_EMAIL?.trim();
  const hash = process.env.AUTH_PASSWORD_HASH?.trim();
  if (email && hash) {
    users.push({
      email,
      passwordHash: hash,
      name: process.env.AUTH_EMAIL_NAME?.trim(),
    });
  }

  return users;
}

export function hasCredentialUsers(): boolean {
  return loadUsersFromEnv().length > 0;
}

export async function verifyCredentialUser(
  email: string,
  password: string
): Promise<CredentialUser | null> {
  const normalized = email.trim().toLowerCase();
  const user = loadUsersFromEnv().find(
    (u) => u.email.trim().toLowerCase() === normalized
  );
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}
