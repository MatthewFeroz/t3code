# Mobile Composer Transitions and Tablet Controls

Recent mobile updates refine composer animations during layout changes and introduce explicit close buttons on tablet views.

## Floating Composer Alignment

- **Side-Pane Synchronized Width**: When toggling or resizing the sidebar, the floating composer width adapts to match the active content width dynamically.
- **Settings Focus Transitions**: Dismissing the model settings sheet (such as with a hardware keyboard on iPad) preserves the composer's expanded card state through the focus handoff back to the editor, avoiding brief collapses.
- **Layout Animation Bounds**: Composer container heights settle at target bounds rather than truncating at intermediate animation frames when soft or hardware keyboards appear.

## Tablet Pane Dismissal

- **Files Inspector**: On tablet layouts, the Files pane includes an explicit close button to dismiss auxiliary navigation.
- **Terminal View**: The tablet Terminal screen provides a dedicated close button to return to the active thread while keeping the background shell process running.
