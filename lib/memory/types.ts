export type MemoryRecord = {
  id?: string;

  userId: string;

  role: "user" | "assistant";

  title: string;

  content: string;

  createdAt?: string;
};