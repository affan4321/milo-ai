import assert from "node:assert/strict";
import { RemoteEmbeddings } from "@milo/providers";
import { createEmbedServer } from "./embed-server";

const server = createEmbedServer(async (texts, task) => texts.map((t) => [t.length, task === "query" ? 1 : 0]), "s3cret");
await new Promise<void>((r) => server.listen(0, r));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
const ok = new RemoteEmbeddings({ url, token: "s3cret" });
assert.deepEqual(await ok.embed(["abc", "de"], "query"), [[3, 1], [2, 1]]);
assert.deepEqual(await ok.embed(["abc"]), [[3, 0]]);
await assert.rejects(new RemoteEmbeddings({ url, token: "wrong" }).embed(["x"]), /rejected/);
await assert.rejects(new RemoteEmbeddings({ url: "http://127.0.0.1:1", token: "s3cret" }).embed(["x"]), /unreachable/);
assert.equal((await fetch(`${url}/embed`, { method: "POST", headers: { authorization: "Bearer s3cret" }, body: "{" })).status, 400);
assert.equal((await fetch(`${url}/embed`, { method: "POST", headers: { authorization: "Bearer s3cret" }, body: JSON.stringify({ texts: [] }) })).status, 400);
assert.equal((await fetch(`${url}/embed`)).status, 404);
server.close();
console.log("embed server tests passed");
