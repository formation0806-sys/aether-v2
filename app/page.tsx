import AuthenticatedRedirect from "@/components/auth/AuthenticatedRedirect";
import HomeNav from "@/components/marketing/HomeNav";
import HomeHero from "@/components/marketing/HomeHero";
import HomeIdea from "@/components/marketing/HomeIdea";
import HomeBeginning from "@/components/marketing/HomeBeginning";
import HomeCognition from "@/components/marketing/HomeCognition";
import HomeInnerState from "@/components/marketing/HomeInnerState";
import HomeHuman from "@/components/marketing/HomeHuman";
import HomeInterlude from "@/components/marketing/HomeInterlude";
import HomeMemory from "@/components/marketing/HomeMemory";
import HomeJourney from "@/components/marketing/HomeJourney";
import HomeContinuity from "@/components/marketing/HomeContinuity";
import HomeExperience from "@/components/marketing/HomeExperience";
import HomePrinciples from "@/components/marketing/HomePrinciples";
import HomeBuilding from "@/components/marketing/HomeBuilding";
import HomeFinalCta from "@/components/marketing/HomeFinalCta";
import HomeClosing from "@/components/marketing/HomeClosing";
import HomeFooter from "@/components/marketing/HomeFooter";
import "@/components/marketing/salpa-home.css";
import "@/components/marketing/salpa-cognition.css";
import { createClient } from "@/lib/supabase/server";

/**
 * Public SALPA homepage (`/`) — presentation only.
 *
 * Server component: checks the session (unchanged auth behavior —
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
    <div className="min-h-dvh overflow-x-clip bg-[#05080D] text-white antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black"
      >
        Skip to content
      </a>
      <HomeNav />
      <main id="main">
        <HomeHero />
        <HomeIdea />
        <div aria-hidden className="salpa-trace" />
        <HomeBeginning />
        <HomeCognition />
        <div aria-hidden className="salpa-trace" />
        <HomeInnerState />
        <HomeHuman />
        <HomeInterlude />
        <div aria-hidden className="salpa-trace" />
        <HomeMemory />
        <HomeJourney />
        <div aria-hidden className="salpa-trace" />
        <HomeContinuity />
        <HomeExperience />
        <HomePrinciples />
        <HomeBuilding />
        <HomeFinalCta />
        <HomeClosing />
      </main>
      <HomeFooter />
    </div>
  );
}
