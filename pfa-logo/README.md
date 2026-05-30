# PFA — “The Quadrant” logo kit

The PFA brand mark: a sextant’s graduated limb reduced to a solid clay wedge with the
index point knocked out as a transparent hole. One geometry, every treatment.

## What’s inside

```
pfa-logo/
├─ svg/
│  ├─ mark-clay.svg          ← primary mark (clay #b8673e)
│  ├─ mark-ink.svg           ← monochrome (ink #221a15)
│  ├─ mark-paper.svg         ← reverse / knockout (paper #fffefb)
│  ├─ favicon.svg            ← scalable favicon (clay)
│  └─ lockup-horizontal.svg  ← mark + wordmark (needs Newsreader + IBM Plex Mono)
├─ png/
│  ├─ favicon-16/32/48/64.png    ← transparent, clay
│  ├─ apple-touch-icon.png       ← 180×180, paper bg
│  ├─ icon-192.png / icon-512.png← PWA, paper bg
│  ├─ icon-512-maskable.png      ← PWA maskable (safe-zone padding)
│  └─ icon-512-clay.png          ← alt: clay field, paper mark
├─ QuadrantMark.jsx          ← drop-in React component (mark + lockup)
├─ pfa-mark.css              ← CSS background-image version (data-URI)
├─ site.webmanifest         ← PWA manifest (icons + theme colors)
└─ README.md
```

## Quick start

**HTML `<head>`** (point paths at wherever you place the folder, e.g. `/pfa-logo/`):

```html
<link rel="icon" href="/pfa-logo/svg/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/pfa-logo/png/favicon-32.png" sizes="32x32" />
<link rel="apple-touch-icon" href="/pfa-logo/png/apple-touch-icon.png" />
<link rel="manifest" href="/pfa-logo/site.webmanifest" />
<meta name="theme-color" content="#b8673e" />
```

**React** — preferred for in-app use (crisp at any size, inherits theme):

```jsx
import { QuadrantMark, PfaLockup } from "./pfa-logo/QuadrantMark";

<QuadrantMark size={28} />                  // clay, default
<QuadrantMark size={28} fill="var(--accent)" />  // follows light/dark theme
<PfaLockup markSize={36} />                 // mark + “PFA” + descriptor
```

**Plain CSS** — when you can’t inline SVG:

```html
<link rel="stylesheet" href="/pfa-logo/pfa-mark.css" />
<span class="pfa-mark"></span>
<span class="pfa-mark pfa-mark--paper"></span>   <!-- on dark / clay -->
```

## Colors

| Token       | Hex       | Use                          |
|-------------|-----------|------------------------------|
| Clay        | `#b8673e` | mark, default · theme color  |
| Clay (dark) | `#de8c5d` | mark on dark theme           |
| Ink         | `#221a15` | monochrome / single-colour   |
| Paper       | `#fffefb` | reverse & knockout mark; icon bg |
| Espresso    | `#181412` | dark backgrounds             |

> In-app, prefer the design tokens (`var(--accent)`, `var(--ink-strong)`) over hard hex so the
> mark tracks light/dark automatically. The hex values above are the same colors, flattened.

## Rules

- **Clear space:** keep the plumb-dot diameter free on every side.
- **Min size:** mark holds to 24px in UI, 16px favicon. Wordmark never below 28px.
- **Don’t** stretch, rotate, recolor off-palette, or add shadows/effects.
