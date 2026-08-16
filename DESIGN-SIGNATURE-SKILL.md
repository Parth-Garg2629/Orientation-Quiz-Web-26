# DESIGN-SIGNATURE-SKILL.md — OrientQuiz Design Signature

When building or restyling any OrientQuiz screen (team or admin), this skill supplies the signature visual devices and copy voice that make the app read as a purpose-built competition instrument rather than a generic Kahoot-style quiz template.

## The Subject
OrientQuiz is not a generic quiz app skin — it's a live competition instrument. It's operated by one organizer at a control desk, played by teams on phones under time pressure, and watched by a room on a projector. The real-world objects it's standing in for are: a stopwatch/scoreboard, an access badge, and a mission control console.

## Token System (Locked)
- **Background & Surfaces**: Light theme, near-white `#FAFAFA`, `#FFFFFF` surface.
- **Ink / Typography**: `#111827` primary text, `#6B7280` muted.
- **Accent**: `#4F46E5` (indigo) reserved strictly for live/attention states (active timer, selected/locked answer, primary action) — never used decoratively.
- **Semantics**: `#DC2626` danger, `#16A34A` success, `#E5E7EB` border.
- **Typefaces**:
  - Display / Monospace: Space Mono / JetBrains Mono (timer, team code, scores).
  - Body / UI: Inter.
  - Rule: Never mix mono and sans on the same line.
- **Spacing / Shape**: 12px card radius, hairline borders (`1px solid #E5E7EB`), touch targets ≥44px on team screens. One focus per screen.

## Signature Elements
1. **The Timer is a Dial**: Active quiz screen renders the hero countdown inside a thin circular SVG progress ring depleting clockwise like a stopwatch bezel.
2. **The Team Code is a Badge**: Credential-like styling: monospace, wide letter-spacing, hairline card with subtle die-cut/perforation notch on one edge (pure CSS).
3. **The Admin Dashboard is a Control Console**: Monospace state labels (`RUNNING`, `PAUSED`, `SCORED`), status strip as an instrument row, single live switch styling.
4. **Projection View is a Payoff Moment**: Built for a dark room and projector (dark background, large typographic weight for Rank & Score). Winner reveal has celebratory motion.

## Anti-Checklist
- No gradients anywhere.
- No heavy rounded corners + soft drop-shadow stacked.
- No emoji in production UI (use `lucide-react`).
- No unstyled generic components.
- No looping/breathing animations without state changes.
- No confetti except on projector winner reveal.
