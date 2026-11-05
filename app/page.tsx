import AuthenticatedRedirect from "@/components/auth/AuthenticatedRedirect";
import HomeNav from "@/components/marketing/HomeNav";
import HomeHero from "@/components/marketing/HomeHero";
import HomeMemory from "@/components/marketing/HomeMemory";
import HomeMind from "@/components/marketing/HomeMind";
import HomeRoadmap from "@/components/marketing/HomeRoadmap";
import HomeFuture from "@/components/marketing/HomeFuture";
import HomeFooter from "@/components/marketing/HomeFooter";
import "@/components/marketing/salpa-home.css";
import { createClient } from "@/lib/supabase/server";

/**
 * Public SALPA homepage (`/`) ΓÇö presentation only.
 *
 * Composition:
 *   1. Hero        (#hero)         ΓÇö headline, CTAs, humanoid companion
 *   2. Memory      (#memory)       ΓÇö what Salpa does with memory today
 *   3. The mind    (#mind)         ΓÇö human-inspired cognition direction
 *   4. Roadmap     (#how-it-works) ΓÇö live vs. exploring vs. long-term
 *   5. Closing     (#future)       ΓÇö final CTA with a small static figure
 *
 * Followed by the existing navigation (mounted above) and footer.
 *
 * Server component: checks the session (unchanged auth behavior ΓÇö
 * signed-in visitors are redirected to their workspace) and renders
 * the static marketing composition for everyone else.
 */
export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <AuthenticatedRedirect />;
  }

  return (
    <div className="min-h-dvh overflow-x-clip bg-[#000000] text-white antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black"
      >
        Skip to content
      </a>
      <HomeNav />
      <main id="main">
        <HomeHero />
        <HomeMemory />
        <HomeMind />
        <HomeRoadmap />
        <HomeFuture />
      </main>
      <HomeFooter />
    </div>
  );
}