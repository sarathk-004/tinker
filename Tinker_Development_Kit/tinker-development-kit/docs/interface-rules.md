# Interface rules

How the app's screens are built, taken from the Interface Cheat Sheet (https://interfaces.dev/cheat-sheet) and applied in code. Keep new screens to these.

## Applied

- **Nested corners are concentric.** Outer corner = inner corner + the padding between them (cards 20 = picture 12 + padding 8; stat tiles 24 = icon 12 + padding 12).
- **Depth from layered shadows, not borders**: `.lifted` (a hairline ring, a close shadow, a soft far one) and `.lifted-hover` in `src/index.css`.
- **Images and drawings get a 1px inset outline** (`.img-outline`: black 8% in light, white 8% in dark).
- **Hover styles only where hover exists**: Tailwind `future.hoverOnlyWhenSupported`; hover-only controls stay visible on touch.
- **Buttons dip when pressed** (scale 0.97, 160 ms, named properties only, never `transition: all`), inside `prefers-reduced-motion: no-preference`.
- **Landing blocks arrive in small groups** (`.arrive` with `--group`), a beat apart, with a short blur-and-rise; reduced motion turns every animation and transition off.
- **No transitions while the theme switches** (`no-theme-transition` is set for one frame in `src/theme/theme.ts`).
- **Digits keep their width** (`.tabular`), headings balance (`text-wrap: balance`), short descriptions use `.pretty`, badges and labels use `whitespace-nowrap`.
- **Keyboard**: `:focus-visible` outline everywhere; "Skip to content" is the first Tab stop; native buttons and links; icon-only buttons have `aria-label`; hit areas are at least 40 px on the landing pages; routine updates use `role="status"`, errors `role="alert"`; status is never colour alone (the AI allowance has a bar and words).
- **Colours by meaning**: semantic tokens in `src/theme/tokens.css` (light and dark palettes of their own); the landing page's kinds of thing get their own accents (`blue`, `violet`, `amber` next to the brand `primary`).
- **Writing**: buttons start with a verb and say what happens ("Create workspace", "Add person", "Start your first diagram"); empty views explain what belongs there and give one action; the reader is "you".

## Interface sounds

Soft synthesised tones (no sound files) in `src/sound/uiSound.ts`: pop (something added), thump (removed), tick (a component locks onto a guide), chime (workspace or project made), check (export done), deny (export failed), tap (any button press, unless `data-sound="none"`), lift (opening a card). One switch in Settings, Preferences turns them off; the choice is kept in this browser. They play only after a person's own action, and the browser's rule that audio needs a click first applies.

Origin: the idea of small procedural interface sounds follows https://bencho.dev/sounds, but no code, sound table or file was copied from it: its licence page covers the blocks (MIT) and states nothing for the sounds. The tones here are our own values. The same goes for the odometer number (`RollingNumber`) and the lean-toward-the-pointer cards (`TiltCard`), which are our own small versions of the ideas in the Counter and Tilt blocks.
