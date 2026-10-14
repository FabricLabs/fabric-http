# Interface composition
Jade describes a page. The component modules supply the behavior and the inner markup. A `script` tag in the layout's `block scripts` supplies browser JavaScript that is not a component.

If every region is an existing handle, the Jade file is the whole UI. A new component class is only for a feature the catalog does not have.

## Page

`views/client.jade` is the browser reference. `assets/cli.jade` is the same UI for the terminal (`screen`, `grid`, `box`, `form`, `textbox`, `button`). `types/renderer.js` maps that file onto blessed widgets and skips `script` tags.

```jade
extends ./layout.jade

block content
  include ./client.jade

block scripts
  script(type="text/javascript").
    if (customElements && !customElements.get('fabric-peer-list')) {
      customElements.define('fabric-peer-list', FabricPeerList);
    }
```

`views/client.jade` names the regions: history, the `[data-slot="content"]` resource slot, the composer, peers, logs, menu, and debug.

`views/layout.jade` is the document: Semantic CSS, the bundle script, then `block scripts`. `compose` moves body scripts to after `/bundles/browser.min.js`.

Requiring a component registers its handle:

```js
const { Server, compose } = require('@fabric/http');
require('@fabric/http/components/resource-list');
require('@fabric/http/components/resource-view');

const server = new Server();
await server.define('Message', {
  routes: { list: '/messages', view: '/messages/:id' },
  components: { list: 'fabric-resource-list', view: 'fabric-resource-view' }
});
```

Unknown `components.list` or `components.view` handles throw at `define` time. Navigation writes the resource into `[data-slot="content"]` and leaves history, peers, and controls in place.

`compose(source, state, { basedir, filename })` returns HTML. `Compiler` accepts `settings.template` as a Jade string or a file path.

## What Jade may contain

- Tags, attributes, nested blocks, and plain text
- Escaped interpolation (`#{ }` and `=`) in elements and attributes
- `script` tags: an inline body, or `script(src= integrity=)`, placed by `block scripts`
- `extends`, `block`, and `include` inside `basedir`
- `each` for the document shell's script and component import list

Script bodies are the template author's source. Render state is not interpolated into them. `src` and `integrity` may use compiler fields such as the bundle hash.

These are rejected: unbuffered code (`-`), unescaped `!{ }` and `!=`, filters, `if` / `mixin` / `case`, `include` outside `basedir`, and `#{ }` inside a script body.

## Reference handles

| Handle | Module |
| --- | --- |
| `fabric-message-list` | `components/history.js` |
| `fabric-message-composer` | `components/prompt.js` |
| `fabric-peer-list` | `components/peer-list.js` |
| `fabric-log-list` | `components/log-list.js` |
| `fabric-menu` | `components/menu.js` |
| `fabric-debug` | `components/debug.js` |
| `fabric-button` | `components/button.js` |
| `fabric-resource-list` | `components/resource-list.js` |
| `fabric-resource-view` | `components/resource-view.js` |
| `fabric-document` | `components/document.js` |

`fabric-document` is the presentation of a `@fabric/core` `Document` (sealed
blob tree). Core `Document#compile([env, 'fabric-document'])` returns a page
fragment (`extends env` / `block content` / `fabric-document(state=…,
data-merkle-root=…, data-document-id=…)`) that `compose` renders into the
layout's content slot. Server-side output is hash-only: Tree root, blob leaves
(`blobHashHex`, `paymentHashHex`), publisher key, sizes, and ranked provider
offers from the local `DocumentOfferBook`. Buying a blob goes through the
existing 402 flow (`functions/fabricDocumentPayment402.js`,
`documentOffer.blobHashHex`): the component handles its own buy / load buttons
(`data-blob-index`, `data-document-id`, falling back to the `/documents/<id>`
route), addresses records by `documentId` or Tree root, and emits
`paymentRequest` with the parsed request object for the wallet to settle.
Names, URLs, and content appear only client-side after a blob key is held
(`_setOpened({ manifest, blobs })`); a manifest URL becomes a link only when it
is `http:` / `https:`. The reference resource is `FabricDocument.resource`:

```js
const FabricDocument = require('@fabric/http/components/document');
await server.define('Document', FabricDocument.resource);
// routes: { list: '/documents', view: '/documents/:id' }
// components: { list: 'fabric-resource-list', view: 'fabric-document' }
```

`fabric-application`, `fabric-grid`, and `fabric-column` are structural. They are not component classes.

The terminal file maps `box#history` to history, `form` / `textbox` / `button#submit` to the composer, `box#peers` to the peer list, `box#logs` to the log list, and `box#controls` to the menu.
