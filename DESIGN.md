# DukaanSaathi AI visual direction

## Stage 22 direction

The current identity is Ivory Atelier / Forest Studio: soft ivory and sage in light mode, deep forest and olive in dark mode. Editorial Newsreader headlines pair with precise Manrope controls. Use green for decisions and navigation, with warm neutral reading surfaces. Floating navigation may use a restrained frosted surface and blur; forms, tables, assistant messages, and store data stay opaque for contrast. Shadows are soft and offset. The landing header keeps one Explore the Studio link and a one-click Light/Dark control. Preserve the same appearance setting across public, auth, and workspace pages.

The Stage 14 direction below records the previous palette and no longer defines the current color system.

## Stage 14 brand direction

The current interface uses **Ink / Ivory / Electric Blue**. Dark mode pairs ink `#0C0D12` with layered slate `#20232C`, warm ivory `#F7F6F2`, and selective electric blue `#657BFF`/`#B9C4FF`. Light mode uses warm ivory reading surfaces, dark ink typography, and deeper blue controls for contrast. Semantic design tokens in the workspace and landing govern both modes; light is art directed for clarity rather than produced by inverting dark colors. Green remains a semantic success cue. The earlier forest and copper descriptions below document prior phases and should not drive new Stage 14 UI work.

The Assistant is one shared authenticated workspace system. Its floating entry opens the same conversation and history used by the expanded route. Results align with the conversation; confirmed actions must be visually distinct from drafts, clarification, and failure. Motion is brief and purposeful, and the drawer and 3D landing respect reduced motion.

## Brand

**Modern Indian commerce intelligence.** DukaanSaathi AI should feel premium, trustworthy, Indian-commerce aware, modern, conversational, and intelligent. The tone is calm and capable. It should not feel childish, stereotypically “kirana,” or like another purple-gradient AI SaaS site.

## Visual language

- **Surfaces:** near-black charcoal `#171B19` for focused product moments, warm ivory `#F5F2E9` for reading surfaces, and restrained soft charcoal `#222825` for depth.
- **Text:** warm ivory on dark; deep ink `#1B211D` on light. Supporting text must retain comfortable contrast.
- **Accent:** haldi/copper/saffron-inspired `#D2A66E`, used sparingly for key states and emphasis. Subtle emerald is reserved for positive or success states.
- **Borders:** fine neutral lines establish structure. Avoid multiple nested card outlines.
- **Whitespace:** allow large, confident margins. Group by proximity before adding containers.
- **Typography:** use an expressive editorial serif for major statements and a precise sans serif for controls and body copy. Hindi and other Indian language text must have a readable fallback. Keep body copy at least 16 px where reading is primary.

## Workspace themes

Light and dark are equal operating modes. Light uses warm ivory reading surfaces and charcoal type; dark uses layered charcoal and warm ivory type, never pure black. Copper identifies attention and decisions; emerald identifies verified positive states. Use semantic workspace tokens for surfaces, text, borders, fields, and status so every route changes coherently. Translucency belongs only on elevated chrome or a focused overlay. Theme selection persists, follows the system until chosen, and applies before the first paint.

The named modes are **Ivory Market** (cosmic latte and cream, dark forest ink, muted copper) and **Night Bazaar** (deep forest, sage, copper, warm ivory). The public landing responds to the same appearance setting. The DukaanSaathi symbol is a crisp six-sided D with voice lines, paired with a compact wordmark; use the same geometry in the favicon and navigation. Keep the desktop navigation collapsible and use a full-height drawer with labelled destinations on phones.

Operational pages use compact editorial titles and place the first useful control within the initial mobile viewport. Preserve tabular numerals for stock, money, and counts. Mobile directories become readable cards or panes rather than squeezed desktop tables.

## Spacing and shape

Use an 8 px rhythm, with 4 px adjustments for dense controls. Larger sections should breathe at 64–112 px on desktop and 48–72 px on mobile. Use small radii (roughly 8–12 px) for controls and panels; reserve round forms for the Saathi Core and meaningful voice states. Avoid a page made of countless pill-shaped cards.

## Interaction

Hierarchy should be immediately readable: one main action or message per region. Reveal detail only when it helps the next decision. Voice activity needs a visible text state and a clear retry path. Motion should explain listening, thinking, tool execution, or navigation; it should be smooth, restrained, and absent when reduced motion is requested. No constant distracting animation.

## Landing experience

The cinematic **Saathi Core** is a faceted central intelligence object that changes visibly between listening, thinking, and action. Its initial fallback and settled 3D form share the same angular character. Inventory, ₹, khata, and analytics concepts may orbit or interact with it when they clarify the story. Scroll-led transitions should be controlled. Mobile gets a lightweight fallback. Readability and speed always take priority over 3D.

## Workspace

Navigation covers Overview, Assistant, Inventory, Khata, Sales, Suppliers, and Orders. The assistant should feel like a focused AI command center, with context and verified action results, rather than a WhatsApp clone.

Design distinct voice states: idle, listening, transcribing, reasoning, executing action, speaking, and error/retry. Show the active state in words as well as motion or color. A suggested tool action must look different from a confirmed result.

## Accessibility and responsive rules

- Semantic HTML, full keyboard use, visible focus, and sufficient text contrast are required.
- Do not communicate critical information through animation, color, or audio alone.
- Provide text alternatives for meaningful visualizations and respect `prefers-reduced-motion`.
- Touch targets should be comfortable, and layouts must work at narrow phone widths without horizontal scrolling.

## Do not do

No neon purple gradients, random glowing blobs, excessive glassmorphism, stock illustrations, cartoon shopkeepers, tricolor gimmicks, or emoji-heavy production UI. Do not use 3D merely as decoration. Do not show fabricated store data or imply a suggested action was saved before the server confirms it.
