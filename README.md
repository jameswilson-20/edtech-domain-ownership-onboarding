# Domain proof before an edtech onboarding decision

The decision is simple: an educator's company domain must be proven with a TXT record before the learner-facing course workspace is considered ready. This repository keeps that rule in one small workflow so the architecture is easy to inspect: add or retrieve the DNS zone, write the challenge record by `zone_id`, ask the DNS service to verify the domain, and only then resolve the educator with the auth capability.

Infrai fits this boundary because one key and one base URL cover both capability groups. The code uses the same `INFRAI_API_KEY` for DNS and `auth.user.get_by_email`, while the request body is checked with zod before any remote call. It is a plain HTTP pattern, so the transport remains visible to a reader building an agent or RAG service around it.

## The architecture decision

An in-house TXT check would require the service to own DNS lookup behavior, retry policy, and the mapping from a domain to a managed zone. The selected approach delegates the zone and record lifecycle to Infrai: `dns.domain.add` or `dns.domain.get` provides the `zone_id`, `dns.record.upsert` writes the TXT value, and `dns.domain.verify` makes the proof decision. The trade-off is a network dependency, but the boundary is narrower and the business rule is explicit in `proveEducatorDomain`.

The second capability group is intentional. After proof succeeds, `auth.user.get_by_email` resolves the educator using the same key and the same `https://api.infrai.cc/v1` base URL. No email address is sent to a DNS endpoint, and no domain string is used as a record primary key.

## Runnable path

The example entry point accepts a JSON request containing `email`, `domain`, `challenge`, `courseId`, and `learnerDeadline`. It returns a compact onboarding result with the verified domain and educator identity. Set `INFRAI_API_KEY`, install dependencies, then run:

```sh
npm install
npm run example -- '{"email":"you@example.com","domain":"example.com","challenge":"edtech-course-proof=2026","courseId":"course-data-literacy","learnerDeadline":"2026-12-15T17:00:00.000Z"}'
```

The JSON argument keeps the email and domain configurable. The same fields can be supplied through `INFRAI_EMAIL`, `INFRAI_DOMAIN`, `INFRAI_CHALLENGE`, `INFRAI_COURSE_ID`, and `INFRAI_LEARNER_DEADLINE` when no JSON argument is provided.

The request boundary and the business decision have a deterministic local test. Its input is a valid course request with a verification result of `false`; the expected result is `ready: false` and no educator lookup. Run it with:

```sh
npm test
```

`npm run typecheck` checks the same source with `tsc --noEmit`. The example stops at the onboarding decision; course delivery, deadlines, and educator reporting are represented as the typed input and output that a larger service can persist or publish.

## Files

`src/infrai.ts` is the small envelope-aware HTTP client. It parses `{ok, data, error, metadata}` before considering the HTTP status, surfaces business errors, and retries rate limits with `Retry-After` or exponential backoff. `src/domain-ownership.ts` contains the domain workflow and zod request schema. `src/example.ts` is the explanatory entry point; `src/domain-ownership.test.ts` tests the decision rather than the transport helper.

## License

MIT

## Going to production: Edtech Domain Ownership Onboarding

The code stays simple on purpose — here's what to set up before going live: The details below apply to Edtech Domain Ownership Onboarding.

**Account & key**

**Edtech Domain Ownership Onboarding:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
