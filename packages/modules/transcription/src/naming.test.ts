// Run: npx tsx packages/modules/transcription/src/naming.test.ts
import { nameSegments } from "./naming";
let fails = 0;
const check = (c: unknown, m: string) => { if (!c) { fails++; console.error("FAIL:", m); } };
const seg = (label: string, s: number, e: number) => ({ speakerLabel: label, startMs: s, endMs: e });
const ev = (name: string, atMs: number) => ({ name, atMs });

// basic: diarized labels become real names; caption lag (~1.5s) is accounted for
let out = nameSegments([seg("Speaker 1", 0, 6000), seg("Speaker 2", 6500, 12000), seg("Speaker 1", 12500, 18000)], [ev("Ada", 1500), ev("Bob", 8000), ev("Ada", 14000)]);
check(out.map((s) => s.speakerLabel).join() === "Ada,Bob,Ada", `basic naming (got ${out.map((s) => s.speakerLabel).join()})`);

// diarizer split one person into two labels -> both collapse to the same name
out = nameSegments([seg("Speaker 1", 0, 5000), seg("Speaker 3", 6000, 11000), seg("Speaker 2", 12000, 17000)], [ev("Ada", 1000), ev("Ada", 7000), ev("Bob", 13000)]);
check(out.map((s) => s.speakerLabel).join() === "Ada,Ada,Bob", "over-split speaker merged by name");

// diarizer merged two people into one label -> separated by name
out = nameSegments([seg("Speaker 1", 0, 5000), seg("Speaker 1", 6000, 11000)], [ev("Ada", 1000), ev("Bob", 7000)]);
check(out.map((s) => s.speakerLabel).join() === "Ada,Bob", "merged speakers separated by name");

// no evidence / the bot itself / junk -> keep diarized labels
check(nameSegments([seg("Speaker 1", 0, 5000)], []).map((s) => s.speakerLabel).join() === "Speaker 1", "no events -> unchanged");
check(nameSegments([seg("Speaker 1", 0, 5000)], [ev("Milo AI Notetaker", 100), ev("You", 2000)]).map((s) => s.speakerLabel).join() === "Speaker 1", "the bot's own name is never used");
out = nameSegments([seg("Speaker 1", 60_000, 65_000)], [ev("Ada", 1000)]);
check(out[0]!.speakerLabel === "Speaker 1", "a segment long after the last caption keeps its label");

// weak overlap (<40% of the segment) is not trusted
out = nameSegments([seg("Speaker 1", 0, 10_000)], [ev("Ada", 7500), ev("Bob", 9500)]);
check(out[0]!.speakerLabel === "Speaker 1", "weak evidence keeps the diarized label");

// does not mutate its input
const input = [seg("Speaker 1", 0, 5000)]; nameSegments(input, [ev("Ada", 1000)]); check(input[0]!.speakerLabel === "Speaker 1", "input not mutated");
console.log(fails ? `${fails} FAILED` : "ok"); process.exit(fails ? 1 : 0);
