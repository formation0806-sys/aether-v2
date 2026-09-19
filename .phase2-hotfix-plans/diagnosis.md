AETHER — MOBILE COMPOSER VISIBILITY HOTFIX — DIAGNOSIS
==========================================================
ROOT CAUSE:
Composer is rendered correctly in source (line 504 anchors to parent bottom;
textarea already has size, bg, shadow, placeholder "Ask AETHER…"), and the
hard image (elderly blurred image) shows the composer DOES render on the phone.
The reported "thin line / not visible" is most likely:

1. The shipped `app/chat/page.tsx` is a 3-line shell:
     <Chat />
   with NO padding/spacing around the conversation rail. When the window/viewport
   does not have enough vertical space (especially on phones with safe-area
   insets, or with a top bar + potential keyboard), the fixed bottom composer
   can appear as just a thin line at the very bottom edge because:
   - the page has no margin/padding to keep the bottom composer visually
     separated from the viewport edge, and
   - the 1rem + safe-area padding is applied as the composer's own padding,
     not a page-level separation, so the visible band can collapse visually.

2. There is no `.app-safe-top` usage yet in the shipped code. If a phone top
   safe-area is present and the message list uses `h-full`/`overflow-y-auto` with
   fixed bottom composer, the composition of `top inset` + `bottom inset` can
   cause the visible content region to be smaller than expected, making the
   bottom composer appear clipped to a thin line.

3. The current working tree has NOT yet added `.app-safe-top` OR any page-level
   separation. Phase 2 code exists but a targeted margin-safe-area fix is missing.

Therefore the fix is NOT a broken render; it is a layout/spacing gap:
- Add explicit safe-area-aware top spacing for phone (the new `.app-safe-top`).
- Ensure the chat page wrapper keeps the composer visually clear from the bottom
  edge on small screens (a bottom margin/spacing around the composer region, not
  just the composer's own padding).
- Keep the existing bottom safe-area handling.
- Do not remove visualViewport handling (not proven to be the cause).
- Do not change the composer internals.

EVIDENCE:
- components/ai/Chat.tsx line 504: composer anchored to parent bottom.
- app/globals.css (shipped): `.app-safe-bottom` defined.
- app/globals.css (current dirty tree): NO `.app-safe-top` yet.
- app/chat/page.tsx (shipped): import Chat + <Chat />, no padding/spacing.
- app/layout.tsx (shipped): <body className="min-h-full flex flex-col ...">.

PROPOSED FIX (minimal, in-scope):
1. app/globals.css:
   - Add `.app-safe-top { padding-top: max(env(safe-area-inset-top), 0.75rem); }`
     using the same progressive-enhancement pattern as `.app-safe-bottom`.
   - Add a small phone-safe bottom region separation IF needed by inspecting
     the rendered page. Most likely the right fix is page-level bottom spacing
     around the bottom composer on small screens, using existing utilities only.

2. app/chat/page.tsx (if needed):
   - Add a small wrapper that gives the conversation area breathing room above
     the fixed bottom composer on phones, without changing the composer itself.
   - Keep desktop unaffected.

DO NOT TOUCH:
- components/ai/Chat.tsx composer internals (proven rendered).
- authentication, Supabase, Brevo, memory, retrieval, identity, session.
- navigation drawer, Escape, onClose.
- design tokens, deps.
- Do not delete/revert unrelated dirty work.

NEXT STEP:
Inspect the actual rendered page structure by reading the current working-tree
Chat.tsx + app/chat/page.tsx + globals.css once more, then implement the smallest
safe layout/spacing fix. Do not guess.