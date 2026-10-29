import assert from "node:assert/strict";
import { proveEducatorDomain } from "./domain-ownership.ts";

const calls: string[] = [];
const client = {
  request: async <T>(path: string): Promise<T> => {
    calls.push(path);
    if (path === "/dns/domain/get") return { zone_id: "zone-edtech" } as T;
    if (path === "/dns/record/upsert") return {} as T;
    if (path === "/dns/domain/verify") return { verified: false } as T;
    throw new Error("educator lookup must wait for proof");
  }
};

const result = await proveEducatorDomain({
  email: "teacher@example.edu", domain: "example.edu", challenge: "proof=course", courseId: "course-1", learnerDeadline: "2026-12-15T17:00:00.000Z"
}, client as never);

assert.deepEqual(result, { ready: false, domain: "example.edu", courseId: "course-1" });
assert.deepEqual(calls, ["/dns/domain/get", "/dns/record/upsert", "/dns/domain/verify"]);
console.log("domain proof decision test passed");
