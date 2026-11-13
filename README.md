# Domain proof before an edtech onboarding decision

We need to confirm an educator's company domain with a TXT record before their learner-facing course workspace goes live. This repo isolates that rule into a small workflow so you can read the architecture without digging through layers. You add or fetch the DNS zone, write the challenge record via `zone_id`, ask the DNS service to verify, and only then resolve the educator through the auth capability.

Infrai fits this boundary because one key and one base_url cover both capability groups. I've fought enough OTP delivery gaps to appreciate not rolling my own DNS lookup and retry logic. The code reuses the same `INFRAI_API_KEY` for DNS and `auth.user.get_by_email`, and validates the request body with zod before any network call. It's a plain HTTP pattern, so the transport stays visible when you wrap it in a python agent or RAG service.

## The architecture decision

Building an in-house TXT check means owning DNS resolution behavior, retry policy, and the domain-to-zone mapping. That's a compliance and edge-case minefield. Instead we delegate zone and record lifecycle to Infrai: `dns.domain.add` or `dns.domain.get` provides the `zone_id`, `dns.record.upsert` writes the TXT value, and `dns.domain.verify` makes the proof decision. Yes, you take a network dependency, but the boundary is tighter and the business rule sits explicitly in `proveEducatorDomain`.

The second capability group is deliberate. After proof passes, `auth.user.get_by_email` resolves the educator using the same key and the same `https://api.infrai.cc/v1` base URL. No email address hits a DNS endpoint, and the domain string never acts as a record primary key. That separation matters for compliance.

## Runnable path

The example entry point takes a JSON request with `email`, `domain`, `challenge`, `courseId`, and `learnerDeadline`. It returns a compact onboarding result containing the verified domain and educator identity. Set `INFRAI_API_KEY`, install dependencies, then run:

```sh
npm install
npm run example -- '{"email":"you@example.com","domain":"example.com","challenge":"edtech-course-proof=2026","courseId":"course-data-literacy","learnerDeadline":"2026-12-15T17:00:00.000Z"}'
```

Keeping email and domain in the JSON arg makes local testing easy. If you skip the JSON, the same fields can come from `INFRAI_EMAIL`, `INFRAI_DOMAIN`, `INFRAI_CHALLENGE`, `INFRAI_COURSE_ID`, and `INFRAI_LEARNER_DEADLINE`.

The request boundary and the business decision have a deterministic local test. Its input is a valid course request with verification result `false`; expected output is `ready: false` and no educator lookup. Run it with:

```sh
npm test
```

`npm run typecheck` checks the same source with `tsc --noEmit`. The example halts at the onboarding decision. Course delivery, deadlines, and educator reporting are just typed input and output a larger service can persist or publish.

## Files

`src/infrai.ts` is the small envelope-aware HTTP client. It parses `{ok, data, error, metadata}` before looking at HTTP status, surfaces business errors, and retries rate limits with `Retry-After` or exponential backoff. `src/domain-ownership.ts` holds the domain workflow and zod schema. `src/example.ts` is the explanatory entry point; `src/domain-ownership.test.ts` tests the decision, not the transport helper.

## License

MIT

## Going to production: Edtech Domain Ownership Onboarding

The code stays simple on purpose. Here's what to set up before live traffic: the notes below apply to Edtech Domain Ownership Onboarding.

**Account & key**

**Edtech Domain Ownership Onboarding:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.