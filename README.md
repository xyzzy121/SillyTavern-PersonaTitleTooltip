# Additional Info Tooltips for SillyTavern

Shows the complete text of SillyTavern's additional-info labels:

```html
<small class="ch_additional_info">Full text shown here</small>
```

- Desktop: hover the label.
- Mobile/tablet: press and hold the label for about half a second.
- Dismiss a long-press tooltip by tapping elsewhere, scrolling, or pressing
  <kbd>Escape</kbd> with a hardware keyboard.
- Move the pointer onto a desktop tooltip to select its text. Very long
  tooltips stay within the viewport and can be scrolled.

The extension uses delegated pointer events, so it continues to work when
SillyTavern replaces character, persona, group, or folder entries during list
updates. A drag or scroll cancels a pending long press, and a completed long
press suppresses the following click so it does not accidentally open the
containing card.

## Install

### From a Git repository

1. Open SillyTavern's **Extensions** panel.
2. Choose **Install Extension**.
3. Paste this extension's Git repository URL and install it.
4. Reload SillyTavern if prompted.

### Manual/local development

Copy this entire folder into one of SillyTavern's extension locations:

- Current user: `SillyTavern/data/<user-handle>/extensions/AdditionalInfoTooltip`
- All-user/local development:
  `SillyTavern/public/scripts/extensions/third-party/AdditionalInfoTooltip`

Then reload SillyTavern. The extension has no settings or external
dependencies.

## Files

- `manifest.json` — SillyTavern extension metadata and activation hook.
- `index.js` — hover, long-press, dismissal, click-suppression, and positioning
  logic.
- `style.css` — theme-aware tooltip styling and touch-callout handling.
- `tests/browser-harness.html` — self-contained browser interaction checks.
- `tests/serve.mjs` — zero-dependency local server for the browser harness.

## Test

From this extension folder, run:

```console
node tests/serve.mjs
```

Then open the printed local URL. The harness verifies hover, touch hold,
movement cancellation, click suppression, dynamic targets, live text changes,
long-text scrolling, lifecycle cleanup, and safe text rendering.
