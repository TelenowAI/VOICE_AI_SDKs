# Legal templates for the Telenow e-commerce plugins

Two **templates** you must complete before publishing the apps to any marketplace:

- [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md)
- [`TERMS_OF_SERVICE.md`](TERMS_OF_SERVICE.md)

> ⚠️ **These are templates, not legal advice.** Have qualified counsel review and
> adapt them for your jurisdiction(s) before relying on them.

## How to use
1. Fill every `[BRACKETED]` placeholder (company name, address, emails, effective
   date, governing law, hosting/sub-processors, pricing/privacy URLs).
2. Host the final versions at stable public URLs — e.g. `https://telenow.ai/privacy`
   and `https://telenow.ai/terms`.
3. Reference those URLs everywhere the listings/plugins already point to them:
   - Shopify App Store listing (privacy & data-handling section) — see the
     "App Store listing copy" block in `../shopify-telenow/README.md`.
   - WooCommerce `../woocommerce-telenow/readme.txt` → **External services** section.
   - The in-app settings pages and your marketing site.

## Why both are required
Every marketplace (Shopify, WordPress.org, Adobe Commerce, BigCommerce, Wix)
requires a privacy policy URL, and — because these are **free apps that connect to
a paid external service (Telenow)** — a clear disclosure of that relationship plus
terms. The Terms template also carries the **calling-consent / telemarketing-law
responsibility** clause (TCPA, TRAI/DND, GDPR/ePrivacy), which is essential for a
voice-calling product: the merchant is the caller and must secure consent.
