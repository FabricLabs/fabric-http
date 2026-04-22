## Classes

<dl>
<dt><a href="#App">App</a> ⇐ <code>Component</code></dt>
<dd><p>Applications can be deployed to the legacy web using <a href="#App">App</a>, a powerful
template for building modern web applications.</p>
</dd>
<dt><a href="#Avatar">Avatar</a></dt>
<dd><p>Deterministic avatar generator inspired by academic visual hash work
(e.g. Perrig/Song &quot;Hash Visualization&quot;, a.k.a. &quot;drunken bishop&quot;).</p>
<p>The algorithm walks a diagonal &quot;bishop&quot; across a board using bits from
SHA-256(input), accumulating visit counts to produce a stable identicon.</p>
</dd>
<dt><a href="#Bridge">Bridge</a></dt>
<dd><p>The <a href="#Bridge">Bridge</a> type extends a Fabric application to the web.</p>
</dd>
<dt><a href="#HTTPClient">HTTPClient</a></dt>
<dd><p>Generic HTTP Client.</p>
</dd>
<dt><a href="#Compiler">Compiler</a></dt>
<dd><p>Builder for <a href="Fabric">Fabric</a>-based applications.</p>
</dd>
<dt><a href="#FabricComponent">FabricComponent</a></dt>
<dd><p>Generic component.</p>
</dd>
<dt><a href="#Definition">Definition</a> : <code>Object</code></dt>
<dd></dd>
<dt><a href="#FabricDistributedExecutionHTTP">FabricDistributedExecutionHTTP</a></dt>
<dd></dd>
<dt><a href="#Hub">Hub</a> ⇐ <code>Oracle</code></dt>
<dd><p>The <a href="#Hub">Hub</a> is a temporary class in the Fabric HTTP library
which handles WebRTC and WebSocket connections, wrapping the core
<a href="Fabric">Fabric</a> protocol for legacy web clients (including browsers).</p>
</dd>
<dt><a href="#Maki">Maki</a> : <code>Object</code></dt>
<dd><p>Maki makes building beautiful apps a breeze.</p>
</dd>
<dt><a href="#Remote">Remote</a> : <code><a href="#Remote">Remote</a></code></dt>
<dd><p>Interact with a remote <a href="#Resource">Resource</a>.  This is currently the only
HTTP-related code that should remain in @fabric/core — all else must
be moved to @fabric/http before final release!</p>
</dd>
<dt><a href="#Resource">Resource</a></dt>
<dd><p>Generic interface for collections of digital objects.</p>
</dd>
<dt><a href="#Router">Router</a> : <code>Object</code></dt>
<dd><p>Simple router.</p>
</dd>
<dt><a href="#FabricHTTPServer">FabricHTTPServer</a> ⇐ <code>Service</code></dt>
<dd><p>Fabric Service for exposing an <a href="Application">Application</a> to clients over HTTP.</p>
</dd>
<dt><a href="#Site">Site</a></dt>
<dd><p>Implements a full-capacity (Native + Edge nodes) for a Fabric Site.</p>
</dd>
<dt><a href="#SPA">SPA</a> ⇐ <code><a href="#App">App</a></code></dt>
<dd><p>Fully-managed HTML application.</p>
</dd>
<dt><a href="#UI">UI</a></dt>
<dd><p>User Interface for a Fabric Actor.</p>
</dd>
<dt><a href="#Wallet">Wallet</a> : <code>Object</code></dt>
<dd><p>Manage keys and track their balances.</p>
</dd>
<dt><del><a href="#Stash">Stash</a></del></dt>
<dd><p>Deprecated 2021-10-16.</p>
</dd>
</dl>

## Members

<dl>
<dt><a href="#jsonRpc">jsonRpc</a></dt>
<dd><p>POST JSON-RPC over HTTP; same methods as WebSocket <code>JSONCall</code> when enabled.</p>
</dd>
<dt><a href="#static">static</a></dt>
<dd><p>Passed to <code>express.static</code> (see <code>start()</code>).</p>
</dd>
<dt><a href="#cors">cors</a></dt>
<dd><p>When true, send <code>Access-Control-Allow-*</code> for browser clients.</p>
</dd>
<dt><a href="#compression">compression</a></dt>
<dd><p>When true, use <code>compression</code> middleware if the package is installed.</p>
</dd>
<dt><a href="#sitemap">sitemap</a></dt>
<dd><p>Sitemap generation settings for <code>/sitemap.xml</code>.</p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#merge">merge</a></dt>
<dd><p>HTTP surface for distributed execution: manifest and epoch status for operators.
Binds routes on a <a href="#FabricHTTPServer">FabricHTTPServer</a> via <code>_addRoute</code> (same pattern as Hub services).</p>
</dd>
</dl>

## Functions

<dl>
<dt><a href="#resolvedPathUnderStaticRoot">resolvedPathUnderStaticRoot(relativeCandidate, staticRoot)</a> ⇒ <code>string</code> | <code>null</code></dt>
<dd><p>Resolve <code>relativeCandidate</code> under <code>staticRoot</code> and reject <code>..</code> / absolute escape attempts.</p>
</dd>
</dl>

<a name="App"></a>

## App ⇐ <code>Component</code>
Applications can be deployed to the legacy web using [App](#App), a powerful
template for building modern web applications.

**Kind**: global class  
**Extends**: <code>Component</code>  

* [App](#App) ⇐ <code>Component</code>
    * [new App([settings])](#new_App_new)
    * [._handleNavigation(ctx, next)](#App+_handleNavigation) ⇒ <code>Promise</code>
    * [.render()](#App+render) ⇒ <code>String</code>
    * [.start()](#App+start) ⇒ <code>Promise</code>

<a name="new_App_new"></a>

### new App([settings])
Create a [Web](Web) application.

**Returns**: [<code>App</code>](#App) - Instance of the application.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Application settings. |
| [settings.circuit] | <code>Circuit</code> |  | Instance of an existing [Circuit](Circuit). |
| [settings.resources] | <code>Object</code> |  | Map of [Resource](#Resource) classes. |

<a name="App+_handleNavigation"></a>

### app.\_handleNavigation(ctx, next) ⇒ <code>Promise</code>
Trigger navigation.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: <code>Promise</code> - Resolved on routing complete.  

| Param | Type | Description |
| --- | --- | --- |
| ctx | <code>Context</code> | Navigating context. |
| next | <code>function</code> | Function called if no route found. |

<a name="App+render"></a>

### app.render() ⇒ <code>String</code>
Generate the rendered HTML output of the application's user interface.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: <code>String</code> - HTML string.  
<a name="App+start"></a>

### app.start() ⇒ <code>Promise</code>
Launches any necessary processes and notifies the user on ready.

**Kind**: instance method of [<code>App</code>](#App)  
**Returns**: <code>Promise</code> - Resolves on completion.  
<a name="Avatar"></a>

## Avatar
Deterministic avatar generator inspired by academic visual hash work
(e.g. Perrig/Song "Hash Visualization", a.k.a. "drunken bishop").

The algorithm walks a diagonal "bishop" across a board using bits from
SHA-256(input), accumulating visit counts to produce a stable identicon.

**Kind**: global class  

* [Avatar](#Avatar)
    * [new Avatar([input], [settings])](#new_Avatar_new)
    * [.toASCII()](#Avatar+toASCII) ⇒ <code>String</code>
    * [.render([settings])](#Avatar+render) ⇒ <code>String</code>

<a name="new_Avatar_new"></a>

### new Avatar([input], [settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [input] | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | Seed input used to derive deterministic avatar bytes. |
| [settings] | <code>Object</code> | <code>{}</code> | Optional rendering configuration (size, colors, grid, steps). |

<a name="Avatar+toASCII"></a>

### avatar.toASCII() ⇒ <code>String</code>
Render a deterministic ASCII visual hash for terminal/text comparison.
Lower visit counts use lighter glyphs; higher counts use denser glyphs.

**Kind**: instance method of [<code>Avatar</code>](#Avatar)  
<a name="Avatar+render"></a>

### avatar.render([settings]) ⇒ <code>String</code>
Render a consumable HTML snippet.

**Kind**: instance method of [<code>Avatar</code>](#Avatar)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.format] | <code>&#x27;img&#x27;</code> \| <code>&#x27;svg&#x27;</code> | <code>&#x27;img&#x27;</code> | Output format. |
| [settings.className] | <code>String</code> | <code>&#x27;fabric-avatar&#x27;</code> | CSS class for wrapper output. |
| [settings.alt] | <code>String</code> | <code>&#x27;Fabric Avatar&#x27;</code> | alt label for image output. |

<a name="Bridge"></a>

## Bridge
The [Bridge](#Bridge) type extends a Fabric application to the web.

**Kind**: global class  

* [Bridge](#Bridge)
    * [new Bridge([settings])](#new_Bridge_new)
    * [.connect()](#Bridge+connect) ⇒ [<code>Bridge</code>](#Bridge)
    * [.query(request)](#Bridge+query)

<a name="new_Bridge_new"></a>

### new Bridge([settings])
Create an instance of the bridge by providing a host.

**Returns**: [<code>Bridge</code>](#Bridge) - Instance of the bridge.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Settings for the bridge. |

<a name="Bridge+connect"></a>

### bridge.connect() ⇒ [<code>Bridge</code>](#Bridge)
Attempt to connect to the target host.

**Kind**: instance method of [<code>Bridge</code>](#Bridge)  
**Returns**: [<code>Bridge</code>](#Bridge) - Instance of the bridge.  
<a name="Bridge+query"></a>

### bridge.query(request)
Request a Document from our Peers.

**Kind**: instance method of [<code>Bridge</code>](#Bridge)  

| Param | Type | Description |
| --- | --- | --- |
| request | <code>Object</code> | Request to send. |
| request.path | <code>String</code> | Document path. |

<a name="HTTPClient"></a>

## HTTPClient
Generic HTTP Client.

**Kind**: global class  
<a name="new_HTTPClient_new"></a>

### new HTTPClient([settings])
Create an instance of an HTTP client.


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration for the client. |

<a name="Compiler"></a>

## Compiler
Builder for [Fabric](Fabric)-based applications.

**Kind**: global class  

* [Compiler](#Compiler)
    * [new Compiler([settings])](#new_Compiler_new)
    * [.compile([data])](#Compiler+compile) ⇒ <code>String</code>
    * [._compileToFile(target)](#Compiler+_compileToFile) ⇒ <code>Boolean</code>

<a name="new_Compiler_new"></a>

### new Compiler([settings])
Create an instance of the compiler.


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Map of settings. |
| [settings.document] | <code>HTTPComponent</code> | Document to use. |

<a name="Compiler+compile"></a>

### compiler.compile([data]) ⇒ <code>String</code>
Build a [String](String) representing the HTML-encoded Document.

**Kind**: instance method of [<code>Compiler</code>](#Compiler)  
**Returns**: <code>String</code> - Rendered HTML document containing the compiled JavaScript application.  

| Param | Type | Description |
| --- | --- | --- |
| [data] | <code>Mixed</code> | Input data to use for local rendering. |

<a name="Compiler+_compileToFile"></a>

### compiler.\_compileToFile(target) ⇒ <code>Boolean</code>
Compiles a Fabric component to an HTML document.

**Kind**: instance method of [<code>Compiler</code>](#Compiler)  
**Returns**: <code>Boolean</code> - True if the build succeeded, false if it did not.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| target | <code>String</code> | <code>assets/index.html</code> | Path to output HTML. |

<a name="FabricComponent"></a>

## FabricComponent
Generic component.

**Kind**: global class  

* [FabricComponent](#FabricComponent)
    * [new FabricComponent([settings])](#new_FabricComponent_new)
    * [._loadHTML([content])](#FabricComponent+_loadHTML) ⇒ <code>String</code>
    * [.toHTML()](#FabricComponent+toHTML) ⇒ <code>String</code>

<a name="new_FabricComponent_new"></a>

### new FabricComponent([settings])
Create a component.

**Returns**: <code>Component</code> - Fully-configured component.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Settings for the component. |

<a name="FabricComponent+_loadHTML"></a>

### fabricComponent.\_loadHTML([content]) ⇒ <code>String</code>
Load an HTML string into the Component.

**Kind**: instance method of [<code>FabricComponent</code>](#FabricComponent)  
**Returns**: <code>String</code> - HTML document.  

| Param | Type | Description |
| --- | --- | --- |
| [content] | <code>String</code> | HTML string to load (empty by default). |

<a name="FabricComponent+toHTML"></a>

### fabricComponent.toHTML() ⇒ <code>String</code>
Generate an HTML representation of the component.

**Kind**: instance method of [<code>FabricComponent</code>](#FabricComponent)  
**Returns**: <code>String</code> - HTML of the rendered component.  
<a name="Definition"></a>

## Definition : <code>Object</code>
**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Human-friendly name for this type. |
| name | <code>String</code> | Human-friendly plural name for this type. |
| routes | <code>Object</code> | Path hint for retrieving an index. |
| routes.list | <code>String</code> | Path hint for retrieving an index. |
| routes.view | <code>String</code> | Path hint for retrieving a single entity. |

<a name="FabricDistributedExecutionHTTP"></a>

## FabricDistributedExecutionHTTP
**Kind**: global class  

* [FabricDistributedExecutionHTTP](#FabricDistributedExecutionHTTP)
    * [new FabricDistributedExecutionHTTP([settings])](#new_FabricDistributedExecutionHTTP_new)
    * [.bind(httpServer)](#FabricDistributedExecutionHTTP+bind)

<a name="new_FabricDistributedExecutionHTTP_new"></a>

### new FabricDistributedExecutionHTTP([settings])

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  |  |
| [settings.basePath] | <code>string</code> | <code>&quot;&#x27;/services/distributed&#x27;&quot;</code> |  |
| [settings.getManifest] | <code>function</code> |  | Returns `Object` or `Promise.<Object>` JSON manifest. |
| [settings.getEpochStatus] | <code>function</code> |  | Returns `Object` or `Promise.<Object>` epoch summary. |

<a name="FabricDistributedExecutionHTTP+bind"></a>

### fabricDistributedExecutionHTTP.bind(httpServer)
Register routes on an HTTP server instance.

**Kind**: instance method of [<code>FabricDistributedExecutionHTTP</code>](#FabricDistributedExecutionHTTP)  

| Param | Type | Description |
| --- | --- | --- |
| httpServer | <code>Object</code> | HTTP server instance exposing `_addRoute(method, path, handler)`. |

<a name="Hub"></a>

## Hub ⇐ <code>Oracle</code>
The [Hub](#Hub) is a temporary class in the Fabric HTTP library
which handles WebRTC and WebSocket connections, wrapping the core
[Fabric](Fabric) protocol for legacy web clients (including browsers).

**Kind**: global class  
**Extends**: <code>Oracle</code>  

* [Hub](#Hub) ⇐ <code>Oracle</code>
    * [new Hub(configuration)](#new_Hub_new)
    * [.start()](#Hub+start)

<a name="new_Hub_new"></a>

### new Hub(configuration)
Create an instance of the Hub.


| Param | Type | Description |
| --- | --- | --- |
| configuration | <code>Object</code> | Settings for the [Hub](#Hub). |

<a name="Hub+start"></a>

### hub.start()
Start the [Hub](#Hub) and listen for incoming connections.

**Kind**: instance method of [<code>Hub</code>](#Hub)  
<a name="Maki"></a>

## Maki : <code>Object</code>
Maki makes building beautiful apps a breeze.

**Kind**: global class  

* [Maki](#Maki) : <code>Object</code>
    * [new Maki([settings])](#new_Maki_new)
    * [.render()](#Maki+render) ⇒ <code>String</code>

<a name="new_Maki_new"></a>

### new Maki([settings])
Build a new application.

**Returns**: [<code>Maki</code>](#Maki) - Instance of Maki.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Configuration for the Maki app. |

<a name="Maki+render"></a>

### maki.render() ⇒ <code>String</code>
Generate an HTML string representing the current state of the app.

**Kind**: instance method of [<code>Maki</code>](#Maki)  
**Returns**: <code>String</code> - HTML-encoded string representing the application.  
<a name="Remote"></a>

## Remote : [<code>Remote</code>](#Remote)
Interact with a remote [Resource](#Resource).  This is currently the only
HTTP-related code that should remain in @fabric/core — all else must
be moved to @fabric/http before final release!

**Kind**: global class  
**Properties**

| Name | Type |
| --- | --- |
| settings | <code>Object</code> | 
| secure | <code>Boolean</code> | 


* [Remote](#Remote) : [<code>Remote</code>](#Remote)
    * [new Remote(target)](#new_Remote_new)
    * [.request(type, path, [params])](#Remote+request) ⇒ <code>FabricHTTPResult</code>

<a name="new_Remote_new"></a>

### new Remote(target)
An in-memory representation of a node in our network.


| Param | Type | Description |
| --- | --- | --- |
| target | <code>Object</code> | Target object. |
| target.host | <code>String</code> | Named host, e.g. "localhost". |
| target.secure | <code>String</code> | Require TLS session. |

<a name="Remote+request"></a>

### remote.request(type, path, [params]) ⇒ <code>FabricHTTPResult</code>
Make an HTTP request to the configured authority.

**Kind**: instance method of [<code>Remote</code>](#Remote)  

| Param | Type | Description |
| --- | --- | --- |
| type | <code>String</code> | One of `GET`, `PUT`, `POST`, `DELETE`, or `OPTIONS`. |
| path | <code>String</code> | The path to request from the authority. |
| [params] | <code>Object</code> | Options. |

<a name="Resource"></a>

## Resource
Generic interface for collections of digital objects.

**Kind**: global class  
<a name="new_Resource_new"></a>

### new Resource(definition)

| Param | Type | Description |
| --- | --- | --- |
| definition | <code>Object</code> | Initial parameters |

<a name="Router"></a>

## Router : <code>Object</code>
Simple router.

**Kind**: global class  

* [Router](#Router) : <code>Object</code>
    * [new Router([settings])](#new_Router_new)
    * [._addFlat(path, definition)](#Router+_addFlat) ⇒ <code>Promise</code>

<a name="new_Router_new"></a>

### new Router([settings])
Builds a new [Router](#Router).

**Returns**: [<code>Router</code>](#Router) - Instance of the [Router](#Router).  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Configuration for the router. |

<a name="Router+_addFlat"></a>

### router.\_addFlat(path, definition) ⇒ <code>Promise</code>
Add a named definition.

**Kind**: instance method of [<code>Router</code>](#Router)  
**Returns**: <code>Promise</code> - Resolves once added.  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | Flat path. |
| definition | <code>Object</code> | Resource definition? |

<a name="FabricHTTPServer"></a>

## FabricHTTPServer ⇐ <code>Service</code>
Fabric Service for exposing an [Application](Application) to clients over HTTP.

**Kind**: global class  
**Extends**: <code>Service</code>  

* [FabricHTTPServer](#FabricHTTPServer) ⇐ <code>Service</code>
    * [new FabricHTTPServer([settings])](#new_FabricHTTPServer_new)
    * [.webrtcPeerList](#FabricHTTPServer+webrtcPeerList) ⇒ <code>Array</code>
    * [.define(name, definition)](#FabricHTTPServer+define) ⇒ [<code>FabricHTTPServer</code>](#FabricHTTPServer)
    * [._isJsonRpcTransportAuthorized(req)](#FabricHTTPServer+_isJsonRpcTransportAuthorized) ⇒ <code>boolean</code>
    * [._handleWebSocket(socket, request)](#FabricHTTPServer+_handleWebSocket) ⇒ <code>WebSocket</code>
    * [._handleIndexRequest(req, res)](#FabricHTTPServer+_handleIndexRequest)
    * [._addRoute(method, path, handler)](#FabricHTTPServer+_addRoute)
    * [._notifySubscribers(path, value)](#FabricHTTPServer+_notifySubscribers)
    * [.formatResponse(req, res, data, options)](#FabricHTTPServer+formatResponse)

<a name="new_FabricHTTPServer_new"></a>

### new FabricHTTPServer([settings])
Create an instance of the HTTP server.

**Returns**: [<code>FabricHTTPServer</code>](#FabricHTTPServer) - Fully-configured instance of the HTTP server.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> |  | Configuration values. |
| [settings.name] | <code>String</code> | <code>&quot;FabricHTTPServer&quot;</code> | User-friendly name of this server. |
| [settings.port] | <code>Number</code> | <code>9999</code> | Port to listen for HTTP connections on. |

<a name="FabricHTTPServer+webrtcPeerList"></a>

### fabricHTTPServer.webrtcPeerList ⇒ <code>Array</code>
Get a list of WebRTC peers registered with this server (see Hub `RegisterWebRTCPeer`).

**Kind**: instance property of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  
**Returns**: <code>Array</code> - Array of WebRTC peer objects  
<a name="FabricHTTPServer+define"></a>

### fabricHTTPServer.define(name, definition) ⇒ [<code>FabricHTTPServer</code>](#FabricHTTPServer)
Define a [Type](Type) by name.

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  
**Returns**: [<code>FabricHTTPServer</code>](#FabricHTTPServer) - Instance of the configured server.  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Human-friendly name of the type. |
| definition | [<code>Definition</code>](#Definition) | Configuration object for the type. |

<a name="FabricHTTPServer+_isJsonRpcTransportAuthorized"></a>

### fabricHTTPServer.\_isJsonRpcTransportAuthorized(req) ⇒ <code>boolean</code>
Same authorization inputs as HTTP POST JSON-RPC: verified bearer (`req.authenticated`),
raw `Bearer` on the upgrade/request, or websocket client-token channels.

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  

| Param | Type | Description |
| --- | --- | --- |
| req | <code>Object</code> | Node.js `IncomingMessage` (HTTP upgrade or Express `req`). |

<a name="FabricHTTPServer+_handleWebSocket"></a>

### fabricHTTPServer.\_handleWebSocket(socket, request) ⇒ <code>WebSocket</code>
Connection manager for WebSockets.  Called once the handshake is complete.

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  
**Returns**: <code>WebSocket</code> - Returns the connected socket.  

| Param | Type | Description |
| --- | --- | --- |
| socket | <code>WebSocket</code> | The associated WebSocket. |
| request | <code>http.IncomingMessage</code> | Incoming HTTP request. |

<a name="FabricHTTPServer+_handleIndexRequest"></a>

### fabricHTTPServer.\_handleIndexRequest(req, res)
Special handler for first-page requests.

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  

| Param | Type | Description |
| --- | --- | --- |
| req | <code>HTTPRequest</code> | Incoming request. |
| res | <code>HTTPResponse</code> | Outgoing response. |

<a name="FabricHTTPServer+_addRoute"></a>

### fabricHTTPServer.\_addRoute(method, path, handler)
Add a route manually.

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  

| Param | Type | Description |
| --- | --- | --- |
| method | <code>String</code> | HTTP verb. |
| path | <code>String</code> | HTTP route. |
| handler | <code>function</code> | HTTP handler (req, res, next) |

<a name="FabricHTTPServer+_notifySubscribers"></a>

### fabricHTTPServer.\_notifySubscribers(path, value)
Notify subscribers of a state change

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>String</code> | The path that changed |
| value | <code>\*</code> | The new value |

<a name="FabricHTTPServer+formatResponse"></a>

### fabricHTTPServer.formatResponse(req, res, data, options)
Standardized content negotiation for route handlers.
Handles JSON/HTML negotiation with proper precedence.

**Kind**: instance method of [<code>FabricHTTPServer</code>](#FabricHTTPServer)  

| Param | Type | Description |
| --- | --- | --- |
| req | <code>Object</code> | Express request object |
| res | <code>Object</code> | Express response object |
| data | <code>\*</code> | Data to send |
| options | <code>Object</code> | Formatting options |
| options.title | <code>String</code> | HTML page title |
| options.resourceName | <code>String</code> | Resource name for display |
| options.resourceType | <code>String</code> | Resource type (for HTML rendering) |

<a name="Site"></a>

## Site
Implements a full-capacity (Native + Edge nodes) for a Fabric Site.

**Kind**: global class  
<a name="new_Site_new"></a>

### new Site([settings])
Creates an instance of the [Site](#Site), which provides general statistics covering a target Fabric node.

**Returns**: [<code>Site</code>](#Site) - Instance of the [Site](#Site).  Call `render(state)` to derive a new DOM element.  

| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | Configuration values for the [Site](#Site). |

<a name="SPA"></a>

## SPA ⇐ [<code>App</code>](#App)
Fully-managed HTML application.

**Kind**: global class  
**Extends**: [<code>App</code>](#App)  

* [SPA](#SPA) ⇐ [<code>App</code>](#App)
    * [new SPA([settings], [components])](#new_SPA_new)
    * [.render()](#SPA+render) ⇒ <code>String</code>
    * [._handleNavigation(ctx, next)](#App+_handleNavigation) ⇒ <code>Promise</code>
    * [.start()](#App+start) ⇒ <code>Promise</code>

<a name="new_SPA_new"></a>

### new SPA([settings], [components])
Create a single-page app.

**Returns**: [<code>App</code>](#App) - Instance of the application.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Settings for the application. |
| [settings.name] | <code>String</code> | <code>&quot;@fabric/maki&quot;</code> | Name of the app. |
| [settings.offline] | <code>Boolean</code> | <code>true</code> | Hint offline mode to browsers. |
| [components] | <code>Object</code> |  | Map of Web Components for the application to utilize. |

<a name="SPA+render"></a>

### spA.render() ⇒ <code>String</code>
Return a string of HTML for the application.

**Kind**: instance method of [<code>SPA</code>](#SPA)  
**Overrides**: [<code>render</code>](#App+render)  
**Returns**: <code>String</code> - Fully-rendered HTML document.  
<a name="App+_handleNavigation"></a>

### spA.\_handleNavigation(ctx, next) ⇒ <code>Promise</code>
Trigger navigation.

**Kind**: instance method of [<code>SPA</code>](#SPA)  
**Overrides**: [<code>\_handleNavigation</code>](#App+_handleNavigation)  
**Returns**: <code>Promise</code> - Resolved on routing complete.  

| Param | Type | Description |
| --- | --- | --- |
| ctx | <code>Context</code> | Navigating context. |
| next | <code>function</code> | Function called if no route found. |

<a name="App+start"></a>

### spA.start() ⇒ <code>Promise</code>
Launches any necessary processes and notifies the user on ready.

**Kind**: instance method of [<code>SPA</code>](#SPA)  
**Overrides**: [<code>start</code>](#App+start)  
**Returns**: <code>Promise</code> - Resolves on completion.  
<a name="UI"></a>

## UI
User Interface for a Fabric Actor.

**Kind**: global class  
<a name="Wallet"></a>

## Wallet : <code>Object</code>
Manage keys and track their balances.

**Kind**: global class  
<a name="new_Wallet_new"></a>

### new Wallet([settings])
Create an instance of a [Wallet](#Wallet).

**Returns**: [<code>Wallet</code>](#Wallet) - Instance of the wallet.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [settings] | <code>Object</code> | <code>{}</code> | Configure the wallet. |

<a name="Stash"></a>

## ~~Stash~~
***Deprecated***

Deprecated 2021-10-16.

**Kind**: global class  
<a name="jsonRpc"></a>

## jsonRpc
POST JSON-RPC over HTTP; same methods as WebSocket `JSONCall` when enabled.

**Kind**: global variable  
<a name="jsonRpc.requireAuth"></a>

### jsonRpc.requireAuth
When true, HTTP JSON-RPC requires a verified bearer token (`request.authenticated`).

**Kind**: static property of [<code>jsonRpc</code>](#jsonRpc)  
<a name="static"></a>

## static
Passed to `express.static` (see `start()`).

**Kind**: global variable  
<a name="cors"></a>

## cors
When true, send `Access-Control-Allow-*` for browser clients.

**Kind**: global variable  
<a name="compression"></a>

## compression
When true, use `compression` middleware if the package is installed.

**Kind**: global variable  
<a name="sitemap"></a>

## sitemap
Sitemap generation settings for `/sitemap.xml`.

**Kind**: global variable  
<a name="merge"></a>

## merge
HTTP surface for distributed execution: manifest and epoch status for operators.
Binds routes on a [FabricHTTPServer](#FabricHTTPServer) via `_addRoute` (same pattern as Hub services).

**Kind**: global constant  
<a name="resolvedPathUnderStaticRoot"></a>

## resolvedPathUnderStaticRoot(relativeCandidate, staticRoot) ⇒ <code>string</code> \| <code>null</code>
Resolve `relativeCandidate` under `staticRoot` and reject `..` / absolute escape attempts.

**Kind**: global function  
**Returns**: <code>string</code> \| <code>null</code> - Absolute path, or null if unsafe / invalid.  

| Param | Type |
| --- | --- |
| relativeCandidate | <code>string</code> | 
| staticRoot | <code>string</code> | 

