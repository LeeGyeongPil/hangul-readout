// PRACTICE MOCK: this is a fake LLM, not a real model. It replays fixed token pieces that
// are cut in the middle of numbers, the way a real model's stream can be. Everything after the
// tokens (sentence cutting, reading) is the real library code.
import { normalizeStream } from "../dist/index.js";

const FAKE_TOKENS = [
  "연락처는 010-",
  "1234-5678 입니다. ",
  "사과 3",
  "개예요. ",
  "거리는 3",
  ".",
  "5km 입니다.",
];

async function* fakeLlm() {
  for (const token of FAKE_TOKENS) {
    console.log(`token    ${JSON.stringify(token)}`);
    yield token;
  }
}

console.log("[practice mock] fake token stream -> real sentence chunker + normalizer");
// normalizeStream pulls tokens only when it needs more text,
// so the lines below appear in the order things really happen.
for await (const item of normalizeStream(fakeLlm())) {
  console.log(`sentence ${item.sentence}`);
  console.log(`reading  ${item.text}`);
}
