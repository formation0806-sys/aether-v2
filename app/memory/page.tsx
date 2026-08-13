import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { retrieveMemories } from "@/lib/memory/retrieve";

export default async function MemoryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/signin");
  }

  console.log("CALLER: app/memory/page.tsx");
  console.log("USER PASSED:", user.id);

  const memories = await retrieveMemories(
    user.id,
    ""
  );
  return (
    <main style={{ padding: 40 }}>
      <pre>{JSON.stringify(memories, null, 2)}</pre>
    </main>
  );
}