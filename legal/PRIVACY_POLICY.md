<!--
  Pre-filled with Telenow AI details. STILL NOT LEGAL ADVICE — have qualified
  counsel review before publishing, and confirm the items flagged [CONFIRM]
  (registered legal entity name & full address, full sub-processor list).
  Host the final version at https://telenow.ai/privacy and reference it from each
  marketplace listing and the plugins' External-services disclosure.
-->

# Privacy Policy — Telenow E-commerce Plugins

**Effective date:** June 27, 2026
**Provider:** Telenow AI ("Telenow", "we", "us"), Bangalore (Bengaluru), Karnataka, India [CONFIRM: registered entity name & full address]
**Contact:** support@telenow.ai · https://telenow.ai

This policy explains how the Telenow plugins and apps for e-commerce platforms
(the "App") — currently Shopify and WooCommerce/WordPress, and additional
platforms over time — process personal data. The App connects a merchant's store
to the **Telenow voice-calling platform** ("Telenow Platform") so an AI agent can
place calls to shoppers and record the outcome on the order.

The App is **free to install**. A separate Telenow account is required; usage
(calls) is billed by the Telenow Platform under its own terms.

## 1. Roles
- For the shopper personal data processed to place calls, the **merchant is the
  data controller** and Telenow acts as a **processor / service provider** acting
  on the merchant's instructions (the automations the merchant configures).
- For merchant account data (below), Telenow is a controller.
The merchant is responsible for having a lawful basis and any required consent to
contact its shoppers by phone (see the Terms of Service).

## 2. Data we process
**Merchant / store data:** store domain, the OAuth access token or REST API
credentials used to read orders and write call outcomes, the Telenow API key you
paste, and your automation settings.

**Shopper data (to place a call):** the shopper's **phone number** and the order
context you enable per automation — e.g. first name, order number, item summary,
order total and currency, and a recovery/checkout link. **We never receive or
store payment card data.**

**Call data & outcomes:** the App stores **call metadata** (a session→order
mapping and the result: status, duration, disposition, timestamps) on the order
and in the App's store. The **voice recording and transcript** (if enabled) are
created and held by the **Telenow Platform**, not by the store-side App.

**Technical/log data:** standard request logs needed to operate and secure the
service (with secrets and full phone numbers redacted/masked in logs).

## 3. Why we process it (purposes & legal bases)
To place the calls the merchant configures and return the results to the store
(performance of the merchant's instructions / legitimate interests of running the
store; the merchant secures any consent required by law). To validate the API key
and subscribe to result webhooks. To secure the service and prevent abuse.

## 4. Sharing & sub-processors
- **Telenow Platform** — receives the phone number and order context to place the
  call and returns the outcome; it engages telephony carriers and AI model
  providers as its own sub-processors to deliver the call. See the Telenow
  Platform privacy policy at https://telenow.ai/privacy.
- **Hosting/infrastructure** for the App: cloud infrastructure providers,
  currently Amazon Web Services (AWS). [CONFIRM: full sub-processor list]
- We do **not** sell personal data.

## 5. Retention & deletion
Call metadata is retained on the order and in the App store until deleted by the
merchant, by the platform's privacy webhooks, or on uninstall:
- **Shopify:** the App implements the mandatory `customers/data_request`,
  `customers/redact`, and `shop/redact` webhooks — customer records are exported
  on request and erased on redaction; all shop data is purged on `shop/redact`
  (≈48h after uninstall).
- **WooCommerce:** data lives in the merchant's own WordPress database; uninstall
  removes the App's options. Order notes/meta are retained by the store unless the
  merchant deletes them.
- **Voice recordings/transcripts** held by the Telenow Platform are subject to its
  retention and to redaction requests forwarded to Telenow.

## 6. Data-subject rights
Shoppers may request access, correction, or deletion of their data. Shopify
merchants can use Shopify's privacy request flow (handled by the webhooks above);
otherwise contact the merchant, or contact us at support@telenow.ai and we will
assist the merchant as processor. Rights available depend on your jurisdiction
(e.g. India's Digital Personal Data Protection Act, 2023; GDPR/UK GDPR;
CCPA/CPRA).

## 7. International transfers
We are based in India and process data in India and in other regions used by our
hosting and sub-processors. Where personal data is transferred across borders, we
rely on appropriate safeguards required by applicable law (e.g. Standard
Contractual Clauses for transfers subject to the GDPR). [CONFIRM regions with
counsel]

## 8. Security
Credentials are stored encrypted/secured and never returned in plaintext or
logged; webhooks are verified with HMAC signatures in both directions; transport
is HTTPS; no payment card data is processed. No method is 100% secure.

## 9. Children
The App is not directed to children and we do not knowingly process children's
data.

## 10. Changes
We may update this policy; material changes will be posted at
https://telenow.ai/privacy with a new effective date.

## 11. Contact
Telenow AI, Bangalore (Bengaluru), Karnataka, India · support@telenow.ai
Data Protection Officer / grievance officer (if appointed): support@telenow.ai
