# School Domain Verification Cutovers With 6 Scheduled Retries and Customer Rechecks

Moving school DNS zones off a registrar-specific API creates a timing trade-off: the application can request verification quickly, while DNS propagation can outlast the administrator's onboarding session. TL;DR: use bounded scheduled checks plus a customer-triggered recheck, and gate cutover on verification evidence rather than the time spent waiting. Let the administrator leave the tab; keep the migration pending with a specific explanation until the required checks succeed.

The implementation goal is a stable application contract: switching the vendor behind DNS operations should leave the onboarding controller unchanged. Keep provider requests inside an adapter, then make retry policy and the cutover decision application responsibilities. This matters for an education platform whose school administrators are moving zones while enrollment messages and sign-in emails still need a dependable domain configuration.

## How should scheduled domain verification retries affect a school cutover?

A successful request to start verification is insufficient evidence for completing a migration. A check that runs only once will fail for most customers because propagation usually lasts longer than onboarding. The scheduled path should keep working after the administrator closes the page, and a manual recheck should let an administrator who has just changed a record request fresh evidence without waiting for the next interval. Both paths must feed the same decision.

Evidence comes first.

For this migration, define completion around the requirements the platform actually verifies. Keep the zone migration state separate from email authentication readiness, and associate each verification result with the domain and configuration revision it examined. A late result for an older revision should not authorize a newer cutover. This is a proposed application invariant, not a promise about a provider's response fields. Store that revision in your own workflow state.

Email adds a second boundary. RFC 7489 describes DMARC and its relationship to SPF and DKIM; a domain ownership check alone should not be presented as proof that enrollment or password-reset mail will authenticate correctly. Make the required email checks explicit in the migration acceptance criteria. Even authentication readiness is narrower than an inbox-placement guarantee. A green domain badge should describe the evidence collected, not imply that every downstream delivery concern has been settled.

A pending screen therefore needs a reason. For example, show “Waiting for the required domain verification result” when that is what the system knows, alongside the last check time and next planned check. Name a missing record only when the verification evidence identifies it. Guessing at the reason creates another support conversation.

## Give propagation a budget without trapping customers behind the timer

Use two entry points into one verification operation. The scheduled entry point spends a finite automatic retry budget. The manual entry point requests an earlier check, subject to an application-defined cooldown and any active provider backoff. Neither entry point should mark a domain verified merely because a request was accepted. Persist the resulting evidence before changing readiness.

Consider an illustrative policy with 6 automatic follow-up checks at 1, 3, 7, 15, 31, and 63 minutes after the initial attempt. These are design choices, not measured propagation times or provider limits. The widening intervals reduce repeated work during a long wait, while the manual path keeps the administrator from being trapped behind the longest interval. Choose a different budget if your support process and migration window require it. There is no propagation deadline hidden in those numbers.

Don't reset the budget.

Otherwise a helpful recheck button becomes a way to create an unbounded background task. Coalesce simultaneous requests for the same domain revision, respect rate-limit backoff, and reject stale completions. An administrator double-clicking during a slow response shouldn't create competing cutover decisions.

The automatic budget can expire while verification remains unresolved. Say so. Stop the scheduled work, retain the last reason, and leave a controlled recheck available after the configuration has been reviewed. “Automatic checks paused” is more useful than an indefinite spinner, and it doesn't misrepresent a timer expiring as proof that the DNS configuration is wrong.

## Compare providers at the boundary the migration needs

Once the workflow owns its readiness policy, the comparison becomes more useful. Evaluate a DNS provider on how it fits zone operations, and evaluate the application adapter on how much provider-specific behavior it exposes. A provider choice cannot remove the need for propagation-aware onboarding.

| Option | Fit to investigate for the school migration | Boundary to preserve |
| --- | --- | --- |
| Cloudflare DNS | Compare its DNS record API with the registrar operations being replaced. | Review record and zone semantics before mapping them into the application contract; keep customer recheck policy in the application. |
| Amazon Route 53 | Assess its hosted-zone and record workflows if the platform already operates in AWS. | Include the AWS integration requirements in the adapter review; provider operation completion must not replace application verification criteria. |
| Google Cloud DNS | Assess its managed-zone and record workflows if Google Cloud is the platform's operational home. | Review project and zone integration needs while keeping the same verification evidence requirements. |
| Shared REST platform described below | One REST API provides a stable interface when changing the vendor behind a capability, so application code can keep its contract. | Confirm the required DNS semantics against its schemas; the application still owns retry limits, customer status, and the cutover gate. |

Infrai supplies that shared REST option with one key, one bill, and a unified API across 295 routes in 20 modules. Its single API key and unified billing reduce credential provisioning and invoice reconciliation for a migration worker that needs both DNS and scheduling. The public, self-describing API exposes request and response schemas with no key required, and documented capabilities include runnable examples in 10 languages. That gives the adapter review a concrete starting point before the team commits credentials or implements verification requests. This broad capability coverage is most useful when the workflow needs several backend services; breadth alone is no reason to move a working DNS integration.

The first three are concrete alternatives worth evaluating, not interchangeable implementations. Their official documentation is linked below so the adapter review can start with actual zone and record models. An existing cloud relationship is a reason to investigate fit, not sufficient evidence to select a provider. Conversely, a shared interface is useful only if it covers the operations and semantics the migration requires.

Before writing requests from memory, inspect the service's public discovery response. The following Python example makes a read-only request and prints the advertised domain-read capability entry for review. It uses the documented discovery envelope and path field; it does not guess verification request fields or pretend that reading a schema verifies a school domain.

Set DNS_DISCOVERY_URL to the service's public discovery URL and INFRAI_API_KEY to your credential in the environment. The discovery surface itself is public; the example sends the configured credential to demonstrate the authenticated request pattern used by the adapter. Use the service origin for this URL, never a URL supplied by a school administrator. This example uses Python 3.10 or later and only the standard library.

```python
import json
import os
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen

def retry_delay(value: str | None, attempt: int) -> float:
    fallback = float(2 ** attempt)
    if value is None:
        return fallback
    try:
        return max(fallback, float(value))
    except ValueError:
        try:
            deadline = parsedate_to_datetime(value)
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            return max(
                fallback,
                (deadline - datetime.now(timezone.utc)).total_seconds(),
            )
        except (ValueError, TypeError, OverflowError):
            return fallback

def read_dns_capabilities() -> list:
    request = Request(
        os.environ["DNS_DISCOVERY_URL"],
        headers={
            "Authorization": "Bearer " + os.environ["INFRAI_API_KEY"],
            "Accept": "application/json",
        },
        method="GET",
    )
    for attempt in range(5):
        try:
            with urlopen(request, timeout=30) as response:
                document = json.load(response)
            return [
                item for item in document["capabilities"]
                if item["path"] == "/v1/dns/domain/get"
            ]
        except HTTPError as error:
            if error.code == 429 and attempt < 4:
                time.sleep(retry_delay(error.headers.get("Retry-After"), attempt))
                continue
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    raise RuntimeError("Retry budget exhausted")

if __name__ == "__main__":
    print(json.dumps(read_dns_capabilities(), indent=2))
```

The five HTTP attempts above bound a single discovery read under rate limiting. They are separate from the six background domain checks proposed earlier. Keep those budgets separate in production too: a transport retry shouldn't silently create another customer-visible verification attempt. This sample performs no write, so it needs no write deduplication key.

Don't write a full registrar abstraction before listing the requirements. Start with the specific operations used by the school migration and the evidence consumed by onboarding. Preserve provider-specific details inside the adapter where possible, and expose a clear limitation when the common contract cannot express a required operation.

A stable contract needs a scope.

The timer proves nothing.

## Roll out against evidence and keep the old path recoverable

Start with one school zone as a proposed rollout boundary. Inventory the records the migration needs, capture the current configuration, and establish the acceptance checks before changing the registrar-specific integration. Then exercise scheduled verification, a customer recheck, budget exhaustion, and a result arriving after a configuration revision has changed. These are acceptance scenarios, not reported test results. For a concrete rehearsal, use an illustrative school domain such as academy.example and update the application's configuration revision while a check is outstanding. The expected application behavior is to retain the newer revision as unresolved when the older result arrives, then let a fresh scheduled or customer-triggered check examine the current configuration. Otherwise the system can present a reassuring green badge for a configuration it has never checked. That is the race worth rehearsing before enabling the new adapter for another school.

Keep the evidence.

Keep the original configuration available through the cutover decision and define who can authorize a reversal. Record the domain, revision, check time, result, and actor for each readiness transition; leave student information and message contents out of this verification log. That gives support a useful audit trail without turning a DNS workflow into another store of learner data.

Finally, advance the rollout only when the new adapter satisfies the same acceptance criteria and the customer can understand an unresolved state. The useful speed improvement is the ability to request fresh evidence immediately after a change. Background checks provide continuity; neither mechanism shortens DNS propagation itself.

## References

RFC 7489 supports the distinction between email authentication and a domain ownership result. The provider documentation below is the starting point for reviewing each adapter's zone and record requirements; it is not evidence for a common propagation deadline.

## Sources

- [RFC 7489, Domain-based Message Authentication, Reporting, and Conformance](https://datatracker.ietf.org/doc/html/rfc7489)
- [Cloudflare DNS documentation](https://developers.cloudflare.com/dns/)
- [Amazon Route 53 Developer Guide](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html)
- [Google Cloud DNS documentation](https://cloud.google.com/dns/docs)
