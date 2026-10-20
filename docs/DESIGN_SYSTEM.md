# VigilGrace design system — foundation pass

Scope: tokens, two reference-palette themes, and five core components. No screen was migrated.

## Reference colours → semantic tokens

Printed hex from boards 1, 4, 5; boards 2 and 3 print none, so those were sampled from the images.

| Semantic token | Ivory Rose (light) | Black Cherry (dark) |
|---|---|---|
| bg | Cloud white `#F6F2EF` (b1) | Near black `#1C0B12` (b5) |
| surface | White | `#2A1019` (near black + ~40% black-cherry dark) |
| surfaceElevated | White + soft burgundy shadow | Black-cherry dark `#42121F` (b5) |
| surfaceSunken | Champagne `#EFE1CE` (b5) | `#14070D` |
| textPrimary | Graphite `#3F383D` (b1) | Champagne `#EFE1CE` (b5) |
| textSecondary | Deep plum `#6B4A5E` (b4) | Rose blush `#D8B8BE` (b1) |
| accent (primary actions) | Burgundy `#5A1F2E` (b1) | Rose gold `#B9857C` (b5) |
| accentPressed | Mulberry `#3E2A3A` (b4) | Blush petal `#C39F93` (b2) |
| accentSoft | Blush pink `#F2D7DC` (b4) | Black-cherry dark `#42121F` |
| separator | Rose blush `#D8B8BE` | `#4A2230` |
| borderStrong / inputs | Mauve wood `#A8788E` (b4) | Mauve wood `#A8788E` |
| focusRing | Bronzed wine `#7A3B49` (b1) | Rose blush `#D8B8BE` |
| emergency (SOS only) | `#B4173F`* | `#C81E4A`* |
| success / warning / info | `#3F5E3C`* / `#7A4F0F`* / deep plum | `#A9C4A0`* / `#E0B15A`* / `#C9A3B6`* |

Not used directly: oat, vanilla cream, soft ivory, espresso, deep mocha, sage (kept in `palette.ts` for later illustration/empty-state work).

\* **Functional colours outside the boards.** Burgundy and black cherry are too close to tell an emergency action from a normal one (primary vs emergency contrast in light mode would be 1.9:1), so the emergency red is a lifted black cherry. Green/amber are derived from the sage/bronze families and tuned for contrast. Please confirm or replace these.

## Rules
- Components import semantic tokens (`useTokens()`), never `palette.ts`.
- Emergency colour is reserved for SOS and failures. Primary actions use accent.
- Status is never colour-only: chips carry an icon and a text label.
- Delivery wording is honest: only `delivered` reads as success; `sent` reads "Sent, not confirmed".

## Components (`src/ui/vigil/`)
`VigilButton`, `VigilCard`, `VigilField`, `SosButton`, `StatusChip`, `Icon` (8 + 5 outline icons, 24px grid, 1.75 stroke), `haptic`, `useTokens`.
Motion: 90–140 ms press scale, disabled with reduced motion. `SosButton` calls `onPress` synchronously on the first tap, ignores repeat taps for 700 ms in ready mode, never throttles cancel, and runs its idle ring only in ready mode.

## Preview
Settings → Appearance now lists all four themes, plus a "Design system preview" screen (sample data only; it sends nothing).
