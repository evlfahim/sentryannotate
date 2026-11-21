# SentryAnnotate

> A modular, desktop-first screenshot annotation toolkit featuring privacy blurring, numbered steps, and clipboard export, architected for effortless conversion into a browser extension.

Task: Screenshot annotation tool: capture, arrows, boxes, blur sensitive parts, numbered steps, copy to clipboard or save; later a browser extension #plugin #desktop

## Why it is better than what exists
- vansh-codes/Web-Annotation-Tool lacks desktop capture and blur
- djmeas/jolt-screenshot misses blur and step sequencing
- ncreighton/barbershop... uses paywall and bloat
- General tools lack modular plugin architecture

## Features
- Desktop screen capture
- Arrows, Boxes, Blur, Text, Numbered Steps
- Copy to Clipboard and Save PNG
- Modular Core/UI separation
- Plugin adapter for browser extension
- Keyboard shortcuts
- Undo/Redo
- Dark/Light mode

## Stack
TypeScript, Node.js, Electron, HTML5 Canvas, Sharp, Clipboardy

## Becoming a plugin
Export @sentry/core as a standalone library; replace Electron capture with chrome.tabs.captureVisibleTab and clipboard with navigator.clipboard in the adapter layer to wrap as a browser extension.

## Steps
- [x] 1. Initialize project structure with TypeScript, Electron, and Canvas dependencies; run npm test to verify build pipeline.
- [x] 2. Implement CoreCanvas class with methods for drawBox, drawArrow, and render; run npm test to verify vector operations.
- [x] 3. Add applyBlur method to CoreCanvas using pixel manipulation; run npm test to verify blur output.
- [x] 4. Implement addStep method for numbered overlays; run npm test to verify step rendering.
- [x] 5. Implement exportToPng and copyToClipboard functions; run npm test to verify file and buffer output.
- [x] 6. Create AnnotationUI module with HTML overlay for tool selection and coordinate mapping; run npm start to verify UI loads.
- [x] 7. Integrate electron screen capture module to feed image to CoreCanvas; run npm start and verify capture works.
- [x] 8. Wire UI tools to CoreCanvas methods; run npm start and verify drawing on captured screen.
- [x] 9. Add keyboard shortcuts (Ctrl+C, Ctrl+S, Esc); run npm start and verify shortcuts function.
- [ ] 10. Refactor codebase to separate @sentry/core from @sentry/ui; run npm test to ensure imports work.
- [ ] 11. Create plugin-adapter.ts demonstrating extension usage pattern; run npm run lint to check code quality.
- [ ] 12. Implement undo/redo stack in CoreCanvas; run npm test to verify state management.
- [ ] 13. Optimize blur performance with offscreen canvas; run npm test to verify no main thread blocking.
- [ ] 14. Add dark mode toggle to AnnotationUI; run npm start and verify theme switch.
- [ ] 15. Run full integration test suite; run npm test and verify all tests pass.
- [ ] 16. Write README.md with setup instructions and plugin conversion guide; run cat README.md to verify content.
