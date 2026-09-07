# HTTP 402 — Fabric payment + document exchange

Paid HTTP resources use **`middlewares/payments`** on `@fabric/http` `HTTPServer` when `payments.enabled` and `_registerBitcoin` provides `createInvoice`.

## `X-Fabric-Payment-Request`

On **402**, the response includes:

| Field | Meaning |
|-------|--------|
| **Name** | `X-Fabric-Payment-Request` |
| **Value** | **`base64url`** encoding of **UTF-8 JSON** (Node: `Buffer.from(header, 'base64url').toString('utf8')`) |

Decoded JSON matches `functions/fabricDocumentPayment402.js`:

- **`v`**, **`scheme`**, **`headerTransport`**: **`base64url.v1+json-utf8`** (wire form of this envelope).
- **`documentExchange`**: aligns P2P **FABRIC_DOCUMENT_OFFER** / **FABRIC_DOCUMENT_OFFER_RESPONSE** with **`P2P_INVENTORY_*`** opcodes (@fabric/core `docs/FABRIC_DOCUMENT_OFFER.md`).
- **`invoice`**: sanitized invoice summary (includes **bolt11** when present).
- **`documentOffer`**: optional `{ documentId, contentHashHex, purchasePriceSats, network, blobIndex?, blobHashHex? }` from `settings.payments.documentOffer`.
  - **`contentHashHex`** MUST come from `@fabric/core/functions/documentPaymentHash` (`resolveDocumentContentHashHex`) — never a raw file `sha256`.

## Hub (`hub.fabric.pub`) — priced documents

`settings.http.payments` is passed into `@fabric/http` `HTTPServer`. When **`FABRIC_HTTP_PAYMENTS_ENABLED=1`**, Bitcoin/Lightning invoice creation works, and a **published** document has **`purchasePriceSats` > 0**, **`GET /documents/:id`** with **`Accept: application/json`** **always** returns **402** + **`X-Fabric-Payment-Request`** (with **`documentOffer`** from catalog metadata). No extra env flag is required for document routes. The inventory / HTLC Fabric path is unchanged; this adds an HTTP surface for **Fabric Passport** overlays.

## Lightning L402

Opt in with **`settings.payments.lightningL402`** (and a BOLT11 on the invoice). The server adds:

`WWW-Authenticate: L402 macaroon="<…>",invoice="<bolt11>"` — **macaroon** omitted when **`l402MacaroonBase64`** is unset (invoice-only interop).

See [Lightning Labs L402 specification](https://github.com/lightninglabs/l402/blob/master/protocol-specification.md).
