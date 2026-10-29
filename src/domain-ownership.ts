import { z } from "zod";
import { InfraiClient } from "./infrai.ts";

export const onboardingRequest = z.object({
  email: z.string().email(), domain: z.string().min(1), challenge: z.string().min(1),
  courseId: z.string().min(1), learnerDeadline: z.string().datetime()
});
export type OnboardingRequest = z.infer<typeof onboardingRequest>;

// The record write is the dns.record.upsert capability, addressed by zone_id.

type Domain = { zone_id: string };
type Verification = { verified?: boolean; status?: string };
type User = { id?: string; email?: string; name?: string };

export async function proveEducatorDomain(input: OnboardingRequest, client: InfraiClient): Promise<{ ready: boolean; domain: string; courseId: string; educator?: User }> {
  const request = onboardingRequest.parse(input);
  const domain = await client.request<Domain>("/dns/domain/get", "GET", undefined, { domain: request.domain });
  await client.request("/dns/record/upsert", "PUT", {
    zone_id: domain.zone_id, record_type: "TXT", name: request.domain, content: request.challenge, ttl: 300
  });
  const verification = await client.request<Verification>("/dns/domain/verify", "POST", { domain: request.domain });
  const ready = verification.verified === true || verification.status === "verified";
  if (!ready) return { ready: false, domain: request.domain, courseId: request.courseId };
  const educator = await client.request<User>("/auth/user/get_by_email", "GET", undefined, { email: request.email });
  return { ready: true, domain: request.domain, courseId: request.courseId, educator };
}
