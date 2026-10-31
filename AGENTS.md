# Notes for agents working in this repository

The website (`apps/web`) is the first thing people see of AnyPS5. A tester went through it line by
line in October 2026 and these rules come from that review. Follow them for every user-facing text
and every page, in English and in Turkish, so the same patterns do not come back.

## Writing

- Short plain sentences, one idea each. Cut every word that carries nothing.
- No semicolons.
- No strings of "·"-separated fragments ("Mac · Apple silicon"). Write "and"/"ve" or "&". The
  " · AnyTogether" suffix of a page title is the one exception.
- No "it's not X, it's Y" sentences ("Not a mock-up, real frames", "X değil, Y"). Say what it is.
- No marketing filler and no lines with no function ("For when your friends are asleep.").
- No comma-separated feature lists in leads and hero texts. Name one or two things and stop.
- Card titles in sentence case, the same everywhere ("Play together", not "Play Together").
  Product names keep their capitals.
- Descriptions and leads end with a full stop.
- Turkish: "kontrolcü" for a controller (never "kol" or "kumanda" for the device). "Çevrimiçi" and
  "çevrimdışı" are one word.
- Plain words before technical ones: "Mac" or "M1 or newer", not "Apple silicon", in leads and
  labels. Requirements may stay precise.
- Do not write for robots: no keyboard-shortcut lists ("⌥A answers, ⌥D declines"), no arrow paths
  ("Settings → AnyTogether → Server") unless a step needs it, no version numbers in facts.
- Only true things. Check a claim against the code and the releases before writing it. Never claim
  a store listing, a platform or a feature that does not exist yet.

`apps/web/test/copy-style.test.ts` checks part of this (semicolons, "·", the Turkish words, full
stops, even grids) for the front page and the product pages. Keep it passing and extend it when you
add public strings elsewhere.

## Design

- The bar is emilkowal.ski, impeccable.style and tasteskill.dev. Nothing that looks like a template.
- No accent left borders on cards (the coloured stripe down a card's left edge). Separate cards with
  space, a hairline or a quiet background instead.
- Buttons in a pair are the same width. `.cta-row` is a grid of equal columns, so this is automatic
  for `.cta`; keep new button rows on it rather than a flex row of buttons sized by their labels.
- Icons sit in a fixed square box (`aspect-ratio: 1`, a 24 by 24 viewBox, width and height set in
  CSS), so two icons of different shapes can never overlap or shift their neighbours. Platform
  icons are the platforms' real marks (Apple, Android, Tux, Windows), not look-alikes.
- Card grids are three across and hold 3, 6 or 9 items. A lonely fourth or tenth card looks broken.
- Section spacing stays moderate: the front page's sections sit `clamp(72px, 8vw, 120px)` apart,
  the product pages' chapters `clamp(64px, 8vw, 112px)`. Do not add bigger gaps.
- Keep pages short. A visitor should have decided by the time they reach the friends section of the
  front page. Before adding a section, find one to remove or merge. Details belong on the product
  pages (/mac, /pc, /phone, /together), not on the front page.
- Picture rows are the endless strip (`components/site/Strip.tsx`): dragged by hand, no scrollbar,
  nothing moving by itself. Fewer, calmer pictures beat many busy ones.
- Motion respects `prefers-reduced-motion`. Focus rings come from `:focus-visible` only.
- Before calling UI work done, take headless screenshots on desktop and phone widths and look at
  them. Never open a visible browser or app window on the user's machine.
