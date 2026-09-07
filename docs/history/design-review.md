# gethired — Apple-design review

Audit of the three surfaces (internal dashboard, public careers/apply, candidate
portal) against Apple's design principles (WWDC *Designing Fluid Interfaces*,
*Principles of Great Design*, *Details of UI Typography*). Reviewed 2026-08-17,
after the functional browser-test round.

**Calibration.** This is a server-rendered CRUD tool with no gesture-driven UI —
no drags, sheets, or flicks. The fluid-interface machinery (springs, velocity
handoff, rubber-banding) has nothing to attach to here, and adding gestures to
justify it would violate the *Purpose* and *Simplicity* principles. The audit
therefore targets what actually applies: **response & feedback, typography,
wayfinding, flexibility (responsive + accessibility), and craft.**

---

## A. Changes to make (proposed)

### A1. Response: pressed states on every button — *Response §1*
Buttons have hover color but zero pointer-down feedback; per the skill, feedback
on release-only "feels dead."
**Change:** global `:active` scale (`transform: scale(0.97)`, ~100ms ease-out)
on `.btn-primary`/`.btn-quiet`, guarded by `prefers-reduced-motion`.

### A2. Response: pending state on server-action buttons — *Response §1, Feedback §16*
Every mutation (Save, Publish, Move to stage, Reject, Create slots…) gives no
feedback between click and server response — double-clicks double-submit, and
slow responses read as broken.
**Change:** one small shared `<SubmitButton>` client component using
`useFormStatus`: disables itself and shows a working label while the form is
pending. Swap it in for every form submit button.

### A3. Focus visibility — *Accessibility §14, quality floor*
Inputs show a focus border, but buttons and links have no visible
`:focus-visible` indicator — keyboard navigation is invisible.
**Change:** global `:focus-visible` outline in the brand pine, 2px offset.

### A4. Display typography: size-specific tracking & leading — *Typography §15*
Bricolage Grotesque headings (3xl/4xl) render with default tracking and
line-height; large display text wants negative tracking and tight leading.
**Change:** `letter-spacing: -0.02em; line-height: 1.1` for the display
headings; body stays at 0 tracking. (Body already uses the system font —
correct per the skill; no change.)

### A5. Wayfinding: active nav state + escape routes — *Foundations §16*
- Sidebar never indicates the current section ("Where am I?").
- Public role page (`/careers/[slug]`) has no link back to `/careers`
  ("How do I get out?").
**Change:** highlight the active sidebar item (`aria-current` + style); add a
"← All open roles" link on the public role page.

### A6. Flexibility: responsive layout — *Flexibility §16*
- Internal two-column grids (form builder, candidate profile) are hard
  `grid-cols-2` — they crush on narrow windows.
- The fixed 13rem sidebar makes the dashboard unusable on a phone; HR will
  open candidate profiles from their phone.
**Change:** grids become `grid-cols-1 lg:grid-cols-2`; sidebar collapses to a
compact top bar below `md`.

### A7. Craft: small defects — *Craft §16*
- No favicon → console 404 on every page and an anonymous browser tab.
  **Change:** inline SVG favicon (pine dot on ink — the "track node" mark).
- Timeline's first entry renders "Applied → Applied".
  **Change:** render the initial event as just "Applied".
- Publish button doesn't say what publishing does.
  **Change:** one line of helper text under the builder actions: "Publishing
  makes this version live for new applicants; past applications keep the
  version they answered."

### A8. Agency: confirmation on the one destructive unguarded action — *Agency §16*
Delete question (form builder) and Delete stage are reversible-by-retyping or
guarded; Reject has Restore (good forgiveness). But **Delete slot** and
**Remove member** act instantly with no undo. Stakes are low; a confirm dialog
would be overkill (the skill warns against overusing confirmation).
**Change:** none for flow; keep as-is. Listed here to record the deliberate
decision.

---

## B. Considered and rejected (with reasons)

| Idea | Why rejected |
| --- | --- |
| Springs / gesture-driven motion (drag-to-reorder stages, swipeable rows, sheet modals) | Nothing here is momentum-driven; motion without a gesture to inherit velocity from is decoration. *Purpose* over machinery. Revisit only if a kanban board view is built. |
| Translucent chrome (`backdrop-filter` toolbars/sidebar) | Opaque heavy sidebar already encodes hierarchy correctly ("darker materials separate structural regions"); translucency adds `prefers-reduced-transparency` complexity for zero informational gain. |
| Toasts for action results | Every action's result is visible in-place after revalidation (row moves, chip changes). A toast would duplicate the state change. Reconsider when actions affect off-screen state. |
| Sound / haptics | Web internal tool; no meaningful commit moments that earn it (*Utility* rule). |
| Page-transition animations | Server-rendered navigation is already fast; animated route transitions add latency — the thing §1 says to kill. |

---

## C. Acceptance criteria

1. Every button visibly reacts on pointer-down and while its form is pending;
   double-submitting a form is impossible.
2. Tab-through of any page shows a visible focus indicator on every stop.
3. Display headings carry `-0.02em` tracking / `1.1` leading; body text is
   unchanged system stack.
4. Sidebar marks the current section; public role pages link back to the
   listing.
5. Form builder and candidate profile are single-column below `lg`; the
   dashboard is usable at 390px width.
6. Favicon renders; no 404 in console; timeline first entry reads "Applied".
7. `prefers-reduced-motion` disables the scale transforms.
8. All existing tests still pass (`npm test`, `npm run db:check`), build clean.
