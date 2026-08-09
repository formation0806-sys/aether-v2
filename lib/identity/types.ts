export interface UserIdentity {
  id: string;

  email: string;

  fullName: string;

  avatarUrl?: string;

  preferences: Record<string, unknown>;
}