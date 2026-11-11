// Minimal use. In your own project: import { ... } from "hangul-readout";
// (this file imports the built copy so it runs straight from a checkout: npm run build first).
import { normalize, toSSML } from "../dist/index.js";

const caption = "사과 3개를 사서 3.5km를 걸었어요. 문의는 010-1234-5678";

const result = normalize(caption);
console.log("caption :", caption); // show this on screen
console.log("speech  :", result.text); // send this to the TTS engine
console.log("changes :");
for (const span of result.spans) {
  console.log(`  ${span.rule.padEnd(14)} ${JSON.stringify(span.source)} -> ${JSON.stringify(span.reading)}`);
}

// SSML keeps the original text and only changes how it is spoken.
console.log("ssml    :", toSSML("사과 3개"));
