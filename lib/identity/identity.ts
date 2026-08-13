import { getProfile } from "@/lib/repositories/identity.repository";
import { UserIdentity } from "./types";

export async function getIdentity(
  userId: string
): Promise<UserIdentity | null> {
  const { data, error } = await getProfile(userId);

  if (error || !data) {
    console.error("Identity error:", error);
    return null;
  }

  return {
    id: data.id,
    email: data.email ?? "",
    fullName:
      data.full_name ??
      data.name ??
      "Unknown User",
    avatarUrl:
      data.avatar_url ?? undefined,
    preferences: {},
  };
}