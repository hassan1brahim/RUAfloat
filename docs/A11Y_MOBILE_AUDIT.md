# Mobile + screen-reader audit (Teammate 3)

Fixed in code already; the manual passes below are still owed on real devices.

## Fixed in code

- **Voice start screen** (`?voice=1`): pressing V turned voice mode on and straight back off (two key handlers both toggled). Now the first key only starts it, and focus lands on the voice button.
- **Voice button name**: the whole help paragraph was inside the button, so VoiceOver read ~30 words as its name. Name is now "Voice assistant"; the help is its description.
- **Space in voice mode** no longer hijacks a focused button (it pressed "briefing" instead of the button).
- **Skip link** pointed at a hidden span; it now focuses the voice button.
- **Spoken-text mirror** (`#sr-live`) is `polite`, not `assertive`, so it doesn't cut VoiceOver off mid-sentence.
- **Scenario buttons** expose `aria-pressed`; emoji in button names are `aria-hidden` (no "speaker high volume, Guide me"); page has an `h1`; side columns are labelled landmarks; the map hint and route destination are live regions.
- **Untrusted text is escaped** before it reaches the page (report notes, AI answers, NWS alerts). A report note could previously run script for every viewer.
- **Touch**: 44 px targets on touch screens, 16 px form text (stops iOS zoom), one finger scrolls the page and two move the map, layers + legend fold instead of disappearing, and a "Where do I go?" button stays in thumb reach until the guide card is on screen.
- **Contrast**: `npm run a11y:contrast` checks every text colour pair against WCAG AA. All pass; amber caution on the dark panel is 8.5:1.

## Manual pass: phone sizes

Chrome DevTools at iPhone SE (375×667) and Pixel 7 (412×915), then a real phone on `http://<laptop-ip>:5173`.

- [ ] Header fits on one line; voice button is the 🎧 icon only.
- [ ] "Where do I go?" bottom button scrolls to the card; choose Scott Hall, Guide me, one-handed.
- [ ] Every card fits without sideways scrolling (cameras, sensors, report form, buildings).
- [ ] Map: one finger scrolls the page, two fingers pan; Layers and Legend open and close.
- [ ] Tapping the place dropdown does not zoom the page (iOS).
- [ ] Report flooding: camera opens from the photo picker.

## Manual pass: VoiceOver

Mac: Cmd+F5. iPhone: Settings → Accessibility → VoiceOver. Use Safari on both.

- [ ] Tab from the top: skip link first, then the voice button ("Voice assistant, toggle button").
- [ ] `?voice=1`: the start screen is read; any key or tap starts it; the briefing is spoken AND read.
- [ ] Keys with voice on: Space briefing, G guide, N next step, R repeat, Esc stop, V toggle.
- [ ] Rotor (Ctrl+Opt+U) lists the h1, card headings, and the two side landmarks.
- [ ] Guide me: the destination is announced when the route appears.
- [ ] Note anything read twice (ElevenLabs audio + VoiceOver reading the same line). If it's distracting with VoiceOver on, we can skip TTS when a screen reader is active.

Record results here, one line per check, with device + browser.
