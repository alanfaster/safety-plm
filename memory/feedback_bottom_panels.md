---
name: feedback_bottom_panels
description: Standard pattern for all bottom panels in the app
type: feedback
---

All bottom frames/panels in the app must follow the FTA MCS bar pattern:

- **Default state**: collapsed (36 px strip showing title)
- **Expand**: click on the header bar to expand
- **Resize**: drag the `.bp-resize-handle` strip at the top edge
- **Persist**: height saved to localStorage via a unique key
- **Shared utility**: `js/utils/bottom-panel.js` → `wireBottomPanel(barEl, { key, defaultH, onExpand })`

**HTML structure**:
```html
<div class="bp-bar bp-collapsed" id="...">
  <div class="bp-resize-handle"></div>
  <div class="bp-hdr">
    <span class="bp-title">Panel Title</span>
    <!-- optional subtitle, controls -->
    <span class="bp-toggle">▲</span>
  </div>
  <div class="bp-body">...content...</div>
</div>
```

**Why:** User requested consistency across all pages (FHA, DFMEA, FTA, arch-concept). The FTA MCS bar was the reference implementation.

**How to apply:** Whenever adding a new bottom panel anywhere in the app, always use `bp-bar bp-collapsed` + `wireBottomPanel`. Never use display:none/button-toggle pattern for bottom frames.
