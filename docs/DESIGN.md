# Allowlist interface design

## Overview

The implemented page serves ALST holders and prospective swappers on Sepolia. A warm off-white canvas, large serif headline, pale green launch panel and white swap form make the window and transaction flow the main content. The composition is deliberately quiet: status is written in words, secondary details use native disclosures, and only the current transaction step receives a solid violet action.

This is the design document requested by the assignment. Its root location conflicts with the overriding write scope; `docs/DESIGN.md` is the permitted delivery location. Source of truth: `web/src/styles.css` and `web/src/App.tsx`.

## Colors

The final system uses sRGB hex semantic CSS properties on `:root` in `web/src/styles.css`. There is one light theme. No imagery, transparent color layering behind text or gradients are used.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f5ed` | Page canvas |
| `--surface` | `#ffffff` | Swap panel and selected direction |
| `--field` | `#f3f3ee` | Amount fields and neutral hover |
| `--text` | `#252b26` | Main text and brand |
| `--muted` | `#60675f` | Hints, units and secondary copy |
| `--line` | `#d8ddd2` | Surface boundaries and separators |
| `--control-border` | `#838d80` | Interactive outlines and countdown structure |
| `--accent` / `--accent-hover` | `#5141ac` / `#40318c` | Current primary action / hover |
| `--on-accent` | `#ffffff` | Primary button label |
| `--window` / `--window-text` | `#e5edce` / `#243b2e` | Launch countdown surface and text |
| `--positive-bg` / `--positive-text` | `#e6efdf` / `#37522b` | Eligible-to-swap badge |
| `--error-bg` / `--error-text` | `#fff0e9` / `#8d2e12` | Recoverable error messages |
| `--focus` | `#6847c6` | Keyboard outline |

Measured browser foreground/background pairs: primary text/page 13.20:1; secondary text/page 5.32:1; launch text/launch surface 9.96:1; eligible badge 7.39:1; white/primary violet 7.77:1; swap-panel secondary text/white 5.83:1. Raw values are in `docs/evidence/accessibility.json`. These measurements cover the named pairs, not every possible disabled or system-color state.

## Typography

Body and controls use `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No Inter asset is shipped; the installed system fallback supplies the face. The browser's computed family remains this stack, so the report does not claim that Inter loaded. The headline uses `Georgia, 'Times New Roman', serif`. Addresses use `ui-monospace, SFMono-Regular, Consolas, monospace`. There are no remote font requests.

Body defaults to 16px with unitless 1.5 line height. The shared scale includes `--text-small: .8125rem`, `--text-label: .875rem`, `--text-body: 1rem`, `--text-section: 1.5rem`. Eyebrows use .6875rem, 650 weight and .12em tracking. The display heading clamps from 3.2rem to 5rem at 6vw, 400 weight, 1.02 line height and -.055em tracking. Below 48rem it clamps from 3rem to 4.3rem at 9vw. Section titles use 600 weight and 1.2 line height; the swap title is 1.875rem. Countdown numerals clamp from 2.5rem to 4.5rem, with explicit smaller layouts below the breakpoints. All changing numbers use `tabular-nums`.

Headings balance wrapping; descriptions use `text-wrap: pretty`. Long addresses and errors wrap anywhere. Full wallet and contract addresses remain available as selectable text and explorer links. Form input text is at least 16px on mobile. No fixed height clips paragraphs. `font-synthesis: none` prevents fabricated faces; intermediate weights resolve to available installed faces.

## Layout

`.page` has a 1248px maximum width, centered with 40px inline padding. The header has a 108px minimum height and a single bottom separator. The intro pairs the display headline with a short explanation. `.main-grid` uses `1.13fr 1fr` and a 24px gap; its left column stacks the countdown and wallet access, and its right column holds the swap flow. DOM order remains window → access → swap → pool facts → explanation/activity → contracts.

Spacing is intentionally concentrated around related groups: panel padding 30–32px, major grid gaps 24px, control gaps roughly 12–18px, field internal padding 17–18px. `.pool-strip` uses three columns; `.bottom-grid` pairs the explanation and activity with a 64px gap.

Breakpoints implemented in `web/src/styles.css`:

- At 62rem: page/panel padding shrinks to 24px; the main gap is 18px and supporting sections become more compact.
- At 48rem: the intro and primary/supporting grids become one column; pool facts become label/value rows; footer stacks; contract addresses get their own row. Header remains a wrapping flex layout.
- At 25rem: page margins become 16px, panels use 18px inline padding, the header's wallet/network group stacks, amount typography shrinks and secondary button arrows are removed.

Browser checks cover 1440, 768, 390 and 320 CSS-pixel widths. Expanded contract details did not cause horizontal overflow at the checked widths. Root text size 200% was also checked; this is text enlargement, not browser-native zoom. Native mobile devices and other writing directions remain unverified.

## Elevation & Depth

The interface is mostly flat. Borders establish panels, direction selection and input fields. Only `.swap-panel` has a faint `0 5px 12px #252b2604` shadow. There are no modals or floating transaction controls. The skip link is the sole fixed element and is visually hidden until keyboard focus; its stacking level is 2.

## Shapes

`--radius: 24px` defines major panels. `--control-radius: 12px` defines buttons and the direction group's outer boundary; its 4px padding contains 8px direction buttons. Amount boxes use 14px radii, small inputs use 8px, and badges use a 30px radius. The launch arrow and token identifiers are circles. Brand and launch-arrow containers use rem sizing so text enlargement also enlarges the containers.

## Components

All page patterns are in `web/src/App.tsx`; shared styling is in `styles.css`. This is a single-page implementation, not a general component library.

| Component / pattern | Use and states |
| --- | --- |
| `Arrow({ diagonal })` | Small decorative SVG arrow using `currentColor`; diagonal variant denotes an external destination. |
| `External({ href, children })` | Explorer/faucet links, with a new-tab screen-reader annotation and decorative arrow. |
| `.button`, `.small`, `.full`, `.primary` | Native buttons. Neutral secondary and filled primary variants; visible hover, focus, disabled and loading labels. Minimum touch height 44px; full actions 52px. |
| `.direction` | Two native `aria-pressed` buttons for Buy ALST / Sell ALST; selected border and surface change accompany the state. |
| `.window-panel`, `.countdown` | Three labeled, stable-width time columns. Countdown is not a per-second live region; the contract confirms public opening. |
| `.access-panel`, `.pill.positive` | Account balance and written access status. Disconnected, wrong-chain, pending/unverified, holder-only, EOA-required and eligible states. |
| `.amount-box`, `.tolerance-row` | Explicitly labeled inputs; exact decimal strings are preserved. Field errors identify and focus the invalid control. The received estimate has a linked label and output element. |
| `.advanced`, `.deployment`, explanatory `details` | Native keyboard-operable disclosures, visibly marked by the browser's disclosure triangle. |
| `.review`, `.transaction-status`, `.error` | Visible pre-signing consequence, persistent polite status and actionable alert messages. Submission disables repeated actions; submitted transactions retain explorer links. |
| `.pool-strip`, `.activity` | Live price/block context and bounded HolderSwap activity, with honest loading, empty and unavailable states. |

Every focusable control has a 3px focus outline with 4px offset; forced-colors mode uses `Highlight`. Navigation uses normal Tab order. Press feedback is a 120ms transition and `.96` scale only under `prefers-reduced-motion: no-preference`. No entrance animation or continuous animation is used. The supplied screenshots include focused keyboard state; tests exercise keyboard connect, quote and swap.

## Do's and Don'ts

- Reuse semantic color tokens and the neutral button variants; reserve the filled violet action for the next primary step.
- Start additional sections with `.section-top` and existing spacing. Keep the wallet prerequisite, expected consequence and transaction status beside the action.
- Use native controls and `details` before introducing custom interaction patterns. Keep the visible text and accessible name aligned.
- Preserve complete selectable addresses in details, token units on amounts and tabular numerals on changing values.
- Do not label estimated output as guaranteed. Do not enable financial actions until deployment, chain and eligibility checks pass.
- Do not add remote fonts, decorative dashboards, themes or animations without a product need. Reuse the current one-page hierarchy and relative assets if extending the page.

## Attribution

Design principles adapted from Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Documentation method adapted from Paul Bakaus's [Impeccable document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). The pinned guide was read locally; no upstream instructions expanded this assignment.
