import { retrieveMemories } from "@/lib/memory/retrieve";

export default async function MemoryPage() {
  const memories = await retrieveMemories(
    "57845a97-0315-4252-9d1b-2206588e5b13",
    ""
  );

  return (
    <main style={{ padding: 40 }}>
      <pre>{JSON.stringify(memories, null, 2)}</pre>
    </main>
  );
}