import assert from "node:assert/strict";
import { classifyTeams } from "./teams";

const none = { leave: false, join: false, joinOnWeb: false };
assert.equal(classifyTeams("How do you want to join your Teams meeting?", { ...none, joinOnWeb: true }), "launcher");
assert.equal(classifyTeams("Choose your audio and video settings", { ...none, join: true }), "prejoin");
// the lobby also has a hang-up button: it must read as waiting, not in-call
assert.equal(classifyTeams("Someone in the meeting should let you in soon", { ...none, leave: true }), "waiting");
assert.equal(classifyTeams("Roster", { ...none, leave: true }), "in_call");
assert.equal(classifyTeams("You've been removed from this meeting", { ...none, leave: true }), "removed");
assert.equal(classifyTeams("Anonymous users can't join this meeting", none), "guests_blocked");
assert.equal(classifyTeams("Your request to join was declined", none), "denied");
assert.equal(classifyTeams("You left the meeting. Rejoin", none), "ended");
assert.equal(classifyTeams("", none), "unknown");
console.log("teams classifier tests passed");
