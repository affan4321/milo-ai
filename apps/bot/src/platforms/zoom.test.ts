import assert from "node:assert/strict";
import { classifyZoom, zoomWebUrl } from "./zoom";

assert.equal(zoomWebUrl("https://zoom.us/j/123456789?pwd=abcDEF"), "https://zoom.us/wc/join/123456789?pwd=abcDEF");
assert.equal(zoomWebUrl("https://us02web.zoom.us/j/98765432101?pwd=x&from=addon"), "https://us02web.zoom.us/wc/join/98765432101?pwd=x");
assert.equal(zoomWebUrl("https://zoom.us/j/123456789"), "https://zoom.us/wc/join/123456789");
assert.equal(zoomWebUrl("https://zoom.us/my/someone"), "https://zoom.us/my/someone"); // personal link: left alone
assert.equal(zoomWebUrl("not a url"), "not a url");

const none = { leave: false, join: false, nameInput: false };
assert.equal(classifyZoom("Your Name", { ...none, join: true, nameInput: true }), "prejoin");
// the waiting room also has a Leave control: it must read as waiting, not in-call
assert.equal(classifyZoom("Please wait, the meeting host will let you in soon.", { ...none, leave: true }), "waiting");
assert.equal(classifyZoom("Waiting for the host to start this meeting", none), "waiting");
assert.equal(classifyZoom("Participants (3)", { ...none, leave: true }), "in_call");
assert.equal(classifyZoom("You have been removed from this meeting", { ...none, leave: true }), "removed");
assert.equal(classifyZoom("This meeting has been ended by host", { ...none, leave: true }), "ended");
assert.equal(classifyZoom("This meeting is for authorized attendees only", none), "guests_blocked");
assert.equal(classifyZoom("Invalid meeting ID", none), "bad_link");
assert.equal(classifyZoom("Incorrect passcode", none), "bad_link");
assert.equal(classifyZoom("", none), "unknown");
console.log("zoom tests passed");
