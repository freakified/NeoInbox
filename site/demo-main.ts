// The live demo is the dev harness, which runs the demo mailbox in site mode.
// Imported rather than linked from demo.html: the dev server only serves
// URLs inside site/, while a module import can reach into src/. Not named
// demo.ts: the dev server would answer /demo with that module, not the page.
import "../src/dev/harness";
