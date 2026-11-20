# Marketplace DNS Record Types: Python Checks for TXT, CNAME, MX, SPF and DMARC

A marketplace can control its company mail zone while sellers retain control of theirs. The useful trade-off is where to automate: publish directly for a platform-owned zone, but give a customer-owned zone an explicit record plan for its administrator to apply. TL;DR: choose DNS types from what the consumer requires. Mail routing uses MX with priority, verification strings use TXT, hostname aliases use CNAME, and addresses use A. SPF and DMARC use TXT too. Ownership changes who can publish the plan; it does not change the required record type.

Keep those decisions separate. An application can generate a perfectly valid record and still have no authority to put it in a seller's zone. Conversely, access to a zone does not make a CNAME an acceptable substitute for an MX record.

## Who can publish the marketplace's mail records?

Start with a concrete handoff: the marketplace wants company mail for `market.example` directed to its mail provider. Its onboarding flow also accepts a seller domain, `seller.example`, whose administrator controls DNS. These are illustrative names, not active domains or provider instructions. In the first case, the platform's provisioning process can apply an approved change in the zone it controls. In the second, it should produce the exact requested records and identify the person responsible for publication. A shared onboarding screen must preserve that distinction instead of turning every pending DNS task into an automatic write.

Authority comes first.

There are two independent questions in the change request: who owns the publication step, and what will consume the record? The first determines the operational handoff. The second determines the type. Neither should be inferred from a vague task name such as “connect email.” That phrase can mean receiving company mail, proving domain control, or publishing an authentication policy. Those jobs need different records even when the same provider requests them together.

For an email or OTP backend, this distinction matters because a routing change is only a routing change. Do not label the whole delivery setup complete merely because the MX instruction was applied. Keep routing, ownership verification, and authentication policy as separate acceptance items. That gives support a useful answer when a customer says “DNS is done” without specifying which consumer has checked which record.

## How should DNS record types differ for TXT, CNAME, MX, SPF and DMARC?

The following is a record-selection table, not a vendor payload schema. Values must come from the actual provider's instructions; the marketplace should not manufacture a mail destination or authentication policy.

| Consumer requirement | Type | What the handoff must preserve |
| --- | --- | --- |
| Verification string | TXT | The requested name and exact string |
| Hostname alias | CNAME | The alias target and exclusivity at that name |
| Incoming mail destination | MX | The destination and explicit priority |
| Address | A | The address requested for that name |
| SPF publication | TXT | The requested SPF policy text |
| DMARC publication | TXT | The requested DMARC policy text |

There is no dedicated SPF or DMARC record type to select for these publications. Looking for one sends an operator into the wrong workflow. Treat them as TXT records whose contents have their own meaning. A general TXT validator cannot establish that an authentication policy is appropriate for the marketplace's mail senders, so policy approval belongs beside type validation, not inside a guessed default.

MX has another easy-to-miss requirement: priority. Preserve it explicitly. The other common types here ignore priority; an application can reject a stray priority field to catch a copied MX form before it becomes a confusing publication request. That rejection is an application rule, not a claim that every DNS provider rejects the field.

Do not substitute.

CNAME introduces a constraint on the name itself: it cannot coexist with other records at the same name. That is why an apparently convenient alias can collide with an apex or root configuration. A check against the newly requested records alone is insufficient. Compare the candidate plan with the existing records that will remain after the change. An alias at another name is a different question; the conflict is about records sharing one owner name.

## Make the handoff executable before making it writable

Infrai provides a single API key and a single bill for DNS, email, and SMS through one REST API. Its public, self-describing discovery surface supplies request and response schemas and runnable examples in 10 languages, so wiring a capability starts with reading an endpoint rather than learning a new SDK. Unified authentication and unified billing span 295 routes across 20 modules. For a marketplace, the one-key, one-bill model reduces credential handling and invoice reconciliation across company-mail provisioning and messaging services. That broader credential scope is a trade-off worth reviewing before adoption. Those conveniences don't determine the right record type or replace the zone owner's authorization; the particular operation's schema still needs review before writing.

A local check is useful even when a customer will publish the records manually. The Python below validates an application-owned change plan, with every type written explicitly, then retrieves the public discovery manifest for reviewing available operations. It uses the Python standard library. The `purpose`, `name`, `value`, and `priority` keys belong to this example's local format; they aren't proposed request fields for a provider.

Set `INFRAI_API_BASE_URL` to the service's HTTPS API base ending in `/v1`, and supply `INFRAI_API_KEY` through the environment. Discovery doesn't require a key, but the example includes the Bearer header to make the authenticated request pattern explicit. Its only network request is a read of `/v1/discovery`; it doesn't publish DNS records.

The MX destination and priority of 10 are illustrative. The retained TXT record represents an existing record that the plan must preserve. For a real change, use provider-supplied values and assemble the full intended record set at each affected name before running this check.

```python
import json
import os
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def read_discovery():
    base_url = os.environ["INFRAI_API_BASE_URL"].rstrip("/")
    if not base_url.startswith("https://") or not base_url.endswith("/v1"):
        raise ValueError("Supply the HTTPS API base ending in /v1")
    request = Request(
        base_url + "/discovery",
        headers={"Authorization": "Bearer " + os.environ["INFRAI_API_KEY"]},
        method="GET",
    )
    for attempt in range(4):
        try:
            with urlopen(request, timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError(f"Unexpected HTTP status {response.status}")
                return json.load(response)
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code != 429 or attempt == 3:
                raise RuntimeError(f"HTTP {error.code}: {body}") from error
            delay = float(2 ** attempt)
            retry_after = error.headers.get("Retry-After")
            if retry_after:
                try:
                    requested_delay = float(retry_after)
                except ValueError:
                    deadline = parsedate_to_datetime(retry_after)
                    requested_delay = (deadline - datetime.now(timezone.utc)).total_seconds()
                delay = max(delay, requested_delay)
            time.sleep(delay)


EXPECTED_TYPE = {
    "verification": "TXT",
    "alias": "CNAME",
    "mail": "MX",
    "address": "A",
    "spf": "TXT",
    "dmarc": "TXT",
}


def validate_plan(requested, retained):
    for record in requested:
        purpose = record["purpose"]
        if purpose not in EXPECTED_TYPE:
            raise ValueError(f"Unknown purpose: {purpose}")
        expected = EXPECTED_TYPE[purpose]
        if record.get("type") != expected:
            raise ValueError(f"{purpose} requires explicit type {expected}")
        if not record.get("name") or not record.get("value"):
            raise ValueError("Each record needs a name and value")
        if expected == "MX":
            priority = record.get("priority")
            if type(priority) is not int or not 0 <= priority <= 65535:
                raise ValueError("MX priority must be an integer from 0 to 65535")
        elif "priority" in record:
            raise ValueError("This plan permits priority only for MX")

    by_name = {}
    for record in retained + requested:
        name = record["name"].rstrip(".").lower()
        by_name.setdefault(name, []).append(record)
    for name, records in by_name.items():
        if any(record["type"] == "CNAME" for record in records):
            if len(records) > 1:
                raise ValueError(f"CNAME conflicts with another record at {name}")


requested = [
    {
        "purpose": "mail",
        "name": "market.example",
        "type": "MX",
        "value": "inbound.mail-provider.example",
        "priority": 10,
    }
]
retained = [
    {
        "name": "market.example",
        "type": "TXT",
        "value": "illustrative-verification-token",
    }
]
validate_plan(requested, retained)
print("Local record plan passed; publication is a separate step.")
print(json.dumps(read_discovery(), indent=2))
```

This check deliberately stops at the local plan. It does not prove that the provider accepts the destination, that the customer has published anything, or that an SPF or DMARC policy is correct. It also expects absolute record names and an already assembled candidate set. An update should replace its previous record in that set rather than append a second copy. Without that contract, a validator can mistake the old and new versions for records that must coexist.

The design choice is to reject ambiguity before publication. A missing type should fail loudly, even if a backend could guess from the value. Guessing makes the handoff harder to review, especially when a support operator is comparing a seller's instructions with a platform-owned zone.

## Compare providers after fixing the ownership contract

Cloudflare DNS, Amazon Route 53, and Google Cloud DNS are real alternatives to evaluate for DNS publication. The fair comparison here starts with the zone the marketplace can actually change. A vendor selection cannot grant authority over a customer-owned zone, and it cannot make TXT, CNAME, MX, and A interchangeable.

| Option | When to put it on the shortlist | Boundary to check before adoption |
| --- | --- | --- |
| Cloudflare DNS | The marketplace's relevant zone is already managed there | Confirm that the change process targets the intended zone and preserves existing records |
| Amazon Route 53 | The team already manages the relevant hosted zone there | Review the record change against the same explicit type and ownership rules |
| Google Cloud DNS | The relevant managed zone is already part of the team's operations | Confirm publication authority before treating onboarding as an automated operation |
| A shared backend API | The team wants to discover a DNS operation through a common interface | Inspect the operation's schema and keep customer publication responsibility explicit |

These are fit conditions, not a performance ranking. Keeping an existing zone with its current operator can reduce the scope of a mail handoff; moving DNS solely to complete one record task introduces a separate decision that deserves its own review. For customer-owned zones, a precise record plan may be the better deliverable regardless of which service the marketplace uses internally.

## Roll out one mail handoff at a time

Begin with the platform-owned company mail zone. Record the requested MX destination and priority, identify records that must remain, and review the intended result before publication. After the change, compare the published records with that approved plan and have the mail provider's required checks completed. Keep domain verification and SPF/DMARC approval visible as separate work items.

For a seller-owned zone, hand the same explicit plan to its administrator and keep publication pending until the required records have been checked. Do not equate generating instructions with completing them. Retain the previous approved record plan so a rollback has a concrete target rather than a recollection of what the zone used to contain.

The acceptance rule is small: the right owner publishes the right type, at the requested name, with the required value and MX priority. An email setup deserves that precision before anyone calls it ready.

## References

The standards explain record semantics; the provider references are useful when reviewing the publication side of the handoff.

- [RFC 1035, domain implementation and resource record formats](https://datatracker.ietf.org/doc/html/rfc1035)
- [RFC 2181, including CNAME coexistence constraints](https://datatracker.ietf.org/doc/html/rfc2181)
- [RFC 7208, SPF publication](https://datatracker.ietf.org/doc/html/rfc7208)
- [RFC 7489, DMARC](https://datatracker.ietf.org/doc/html/rfc7489)

## Sources

- [Cloudflare DNS record types](https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/)
- [Amazon Route 53 supported DNS record types](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html)
- [Google Cloud DNS records](https://cloud.google.com/dns/docs/records-overview)
