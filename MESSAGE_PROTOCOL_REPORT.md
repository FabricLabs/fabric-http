# Fabric Message Protocol - Breakdown Report

## Executive Summary

This report documents all possible origins for messages in the Fabric protocol and how they flow through the system. The goal is to identify where unsigned HEARTBEAT messages might be created.

## Message Creation Points

### 1. Direct Message Creation
**Location**: Various files using `Message.fromVector()`

**Pattern**:
```javascript
const message = Message.fromVector(['MessageType', data]);
message.signWithKey(key); // Optional signing
```

**Found Instances**:
- **Server WebSocket Keepalive** (`fabric-http/types/server.js:422`)
  - Creates: `Ping` messages
  - Signs: Yes (with `server._rootKey`)
  - Sends: Via `_sendTo(handle, ping.toBuffer())`

- **Server Pong Response** (`fabric-http/types/server.js:548`)
  - Creates: `Pong` messages
  - Signs: Yes (with `server._rootKey`)
  - Sends: Via `_sendTo(handle, local.toBuffer())`

- **Server JSONCall Response** (`fabric-http/types/server.js:523`)
  - Creates: `JSONCall` messages
  - Signs: Yes (with `this._rootKey`)
  - Sends: Via `socket.send(callResultMessage.toBuffer())`

- **Server GenericMessage Receipt** (`fabric-http/types/server.js:558`)
  - Creates: `GenericMessage` messages
  - Signs: Yes (with `server._rootKey`)
  - Sends: Via broadcast (not directly sent)

- **Client Bridge Ping** (`sensemaker/components/Bridge.js:737`)
  - Creates: `Ping` messages
  - Signs: No (unsigned)
  - Sends: Via `sendMessage(messageBuffer)`

- **Client Bridge Subscribe** (`sensemaker/components/Bridge.js:548`)
  - Creates: `SUBSCRIBE` messages
  - Signs: No (unsigned)
  - Sends: Via `sendMessage(messageBuffer)`

- **Client Bridge Unsubscribe** (`sensemaker/components/Bridge.js:566`)
  - Creates: `UNSUBSCRIBE` messages
  - Signs: No (unsigned)
  - Sends: Via `sendMessage(messageBuffer)`

- **Sensemaker Conversation** (`sensemaker/routes/messages/create_message.js:131,145`)
  - Creates: `Conversation` messages
  - Signs: Sometimes (if `this.key` exists)
  - Sends: Via `this.http.broadcast(message)`

- **Sensemaker OpenAI Events** (`sensemaker/services/sensemaker.js:2977,2984`)
  - Creates: `MessageStart`, `MessageChunk` messages
  - Signs: No (unsigned)
  - Sends: Via `this.http.broadcast(message)`

### 2. Message Parsing (Reception)
**Location**: `fabric-http/types/server.js:454-478`

**Pattern**:
```javascript
// Binary messages
if (msg instanceof Buffer) {
  message = Message.fromBuffer(msg);
}
// JSON messages
else {
  const parsed = JSON.parse(data);
  message = new Message(parsed); // Creates from plain object
}
```

**Key Point**: When a plain JSON object like `{"type":"HEARTBEAT"}` is received, it's parsed and converted to a Message using `new Message(parsed)`. This Message will NOT have a signature if the original JSON didn't include one.

## Message Broadcasting Mechanisms

### 1. HTTP Server Broadcast
**Location**: `fabric-http/types/server.js:324-341`

**Signature**: `broadcast(message)`

**Behavior**:
- Expects: Message instance (calls `message.toBuffer()`)
- Sends to: All WebSocket connections in `this.connections`
- Method: `this.connections[peer].send(message.toBuffer())`

**Called From**:
- `commit()` method (line 215) - broadcasts commit messages
- Store event handlers (lines 282, 289) - broadcasts StateUpdate objects (⚠️ **PLAIN OBJECTS**)
- Sensemaker service (via `this.http.broadcast()`)

**⚠️ ISSUE**: At lines 282-285 and 289-292, plain objects are passed to `broadcast()`:
```javascript
server.broadcast({
  '@type': 'StateUpdate',
  '@data': server.state
});
```
This will fail when `message.toBuffer()` is called on a plain object.

### 2. Peer Broadcast (P2P)
**Location**: `fabric/types/peer.js:255-262`

**Signature**: `broadcast(message, origin = null)`

**Behavior**:
- Expects: Buffer (calls `_writeFabric(message)` directly)
- Sends to: All P2P connections in `this.connections`
- Method: `this.connections[id]._writeFabric(message)`

**Called From**:
- `handleFabricMessage()` (line 321) - ⚠️ **PASSES Message INSTANCE, NOT BUFFER**

**⚠️ ISSUE**: At line 321, `this.agent.broadcast(message)` is called with a Message instance, but `Peer.broadcast` expects a Buffer. This will cause `_writeFabric` to receive a Message instance instead of a Buffer.

### 3. Service Broadcast
**Location**: `fabric/types/service.js:550-560`

**Signature**: `async broadcast(msg)`

**Behavior**:
- Expects: Plain object with `@type` and `@data` properties
- Sends to: Clients in `this.clients` (not WebSocket)
- Method: Emits 'message' event

**Called From**: Not directly used for WebSocket communication

### 4. Handle Fabric Message
**Location**: `fabric-http/types/server.js:318-322`

**Signature**: `async handleFabricMessage(message)`

**Behavior**:
- Receives: Message instance from trusted sources
- Forwards: To `this.agent.broadcast(message)` (P2P Peer)
- ⚠️ **ISSUE**: Passes Message instance to Peer.broadcast which expects Buffer

**Called From**:
- `_handleTrustedMessage()` (via Service.trust event handlers)
- Store event handlers (line 576)

## Message Transformation Points

### 1. Message to Plain Object
**Location**: `fabric/types/message.js:203-218`

**Method**: `message.toObject()`

**Returns**:
```javascript
{
  headers: { ... },
  type: this.type,  // e.g., "HEARTBEAT"
  data: this.data
}
```

**Used In**:
- `fabric-http/types/spa.js:329` - Converts Pong to JSON string: `JSON.stringify(message.toObject())`
- `fabric-http/types/bridge.js:156` - Converts Ping to JSON string (but doesn't send it)
- `fabric-http/types/server.js:495` - Extracts object for Actor creation (not sent)
- `hub.fabric.pub/stores/schemas/types/peer.js:895` - Converts Message to object before broadcasting

### 2. Plain Object to Message
**Location**: `fabric-http/types/server.js:650,670`

**Methods**: `_sendTo()`, `_relayFrom()`

**Behavior**:
```javascript
if (!Buffer.isBuffer(msg)) {
  const message = Message.fromVector(['GenericMessage', JSON.stringify(msg)]);
  if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);
  payload = message.toBuffer();
}
```

**Called With**: Plain objects (converts to GenericMessage)

### 3. Message to Buffer
**Location**: `fabric/types/message.js` (toBuffer method)

**Method**: `message.toBuffer()`

**Used In**: All WebSocket sending operations

## Event-Driven Message Flow

### 1. Service.trust() Event Handlers
**Location**: `fabric/types/service.js:400-441`

**Handlers**:
- `_handleBeat`: Listens to 'beat' events, logs but doesn't broadcast
- `_handleMessage`: Listens to 'message' events, calls `_handleTrustedMessage()`
- `_handleCommit`: Listens to 'commit' events, logs only
- `_handlePatches`: Listens to 'patches' events, emits 'patches'

**Flow**:
```
Trusted Source emits 'message' event
  → _handleMessage handler
    → _handleTrustedMessage()
      → this.emit('message', message)
        → HTTP Server's handleFabricMessage() (if overridden)
          → this.agent.broadcast(message) ⚠️
```

### 2. HTTP Server Event Handlers
**Location**: `fabric-http/types/server.js:1065-1089`

**Handlers**:
- `this.app.on('message')` → `_handleAppMessage()` (just logs)
- `this.on('message')` → Logs only
- `this.on('commit')` → Logs only

**No HEARTBEAT creation found here**

### 3. Store Event Handlers
**Location**: `fabric-http/types/server.js:262-293`

**Handlers**:
- `this.stores[name].on('message')` → Creates Entity, emits 'message', broadcasts StateUpdate
- `this.stores[name].on('commit')` → Broadcasts StateUpdate

**⚠️ ISSUE**: Broadcasts plain objects, not Messages

## Protocol Flow Diagrams

### WebSocket Message Flow (Client → Server)
```
Client Bridge Component
  → sendMessage(buffer)
    → ws.send(buffer)  // WebSocket.send()
      → Server receives Buffer
        → Message.fromBuffer(msg)
          → Message instance created
            → Switch on message.type
              → Handle or log
```

### WebSocket Message Flow (Server → Client)
```
Server creates Message
  → message.signWithKey(key)  // Optional
    → message.toBuffer()
      → socket.send(buffer)
        → Client receives Buffer
          → Message.fromBuffer(msg)
            → Handle message
```

### P2P Message Flow
```
Service emits 'message' event
  → Service.trust() handler
    → _handleTrustedMessage()
      → this.emit('message')
        → HTTP Server handleFabricMessage()
          → this.agent.broadcast(message)  // ⚠️ Message instance
            → Peer.broadcast(message)  // ⚠️ Expects Buffer
              → _writeFabric(message)  // ⚠️ Receives Message, expects Buffer
```

### Broadcast Flow (HTTP Server)
```
Service/Store emits event
  → HTTP Server event handler
    → this.broadcast(message)
      → For each WebSocket connection:
        → message.toBuffer()  // ⚠️ Fails if message is plain object
          → socket.send(buffer)
```

## Critical Issues Identified

### Issue 1: Plain Objects Passed to broadcast() in commit()
**Location**: `fabric-http/types/server.js:200-216`

**Problem**:
```javascript
async commit () {
  if (this['@changes'] && this['@changes'].length) {
    const message = {
      '@type': 'Transaction',
      '@data': {
        changes: this['@changes'],
        state: this.state
      }
    };
    this.emit('message', message);
    this.broadcast(message);  // ⚠️ Plain object passed
  }
}
```

**Impact**: `broadcast()` calls `message.toBuffer()` which will fail on plain objects, causing runtime errors.

**Fix Needed**: Convert to Message before broadcasting:
```javascript
const messageObj = {
  '@type': 'Transaction',
  '@data': {
    changes: this['@changes'],
    state: this.state
  }
};
const message = Message.fromVector(['Transaction', JSON.stringify(messageObj['@data'])]);
if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);
this.broadcast(message);
```

### Issue 2: Plain Objects Passed to broadcast() in Store Handlers
**Location**: `fabric-http/types/server.js:282-285, 289-292`

**Problem**:
```javascript
this.stores[name].on('message', async (message) => {
  // ... handle message ...
  server.broadcast({
    '@type': 'StateUpdate',
    '@data': server.state
  });  // ⚠️ Plain object
});

this.stores[name].on('commit', (commit) => {
  server.broadcast({
    '@type': 'StateUpdate',
    '@data': server.state
  });  // ⚠️ Plain object
});
```

**Impact**: `broadcast()` calls `message.toBuffer()` which will fail on plain objects.

**Fix Needed**: Convert to Message before broadcasting:
```javascript
const message = Message.fromVector(['StateUpdate', JSON.stringify(server.state)]);
if (this._rootKey && this._rootKey.private) message.signWithKey(this._rootKey);
server.broadcast(message);
```

### Issue 3: Message Instance Passed to Peer.broadcast()
**Location**: `fabric-http/types/server.js:321`

**Problem**:
```javascript
async handleFabricMessage (message) {
  await this.agent.broadcast(message);  // message is Message instance
}
```

**Impact**: `Peer.broadcast()` expects Buffer, receives Message instance. `_writeFabric()` will try to hash a Message object incorrectly.

**Current State**: There's a fix attempt at lines 322-326 that converts Message to Buffer, but it may not be working correctly.

**Fix Needed**: Ensure proper conversion:
```javascript
async handleFabricMessage (message) {
  this.emit('debug', `Handling trusted Fabric message: ${message}`);
  // TODO: validation
  if (message && typeof message.toBuffer === 'function') {
    await this.agent.broadcast(message.toBuffer());
  } else if (Buffer.isBuffer(message)) {
    await this.agent.broadcast(message);
  } else {
    console.error('[SERVER]', 'Invalid message type passed to handleFabricMessage:', typeof message);
  }
}
```

### Issue 4: JSON.stringify(message.toObject()) Pattern
**Location**: `fabric-http/types/spa.js:329`

**Pattern**:
```javascript
const pong = JSON.stringify(message.toObject());
this.bridge.send(pong);  // Sends JSON string
```

**Impact**: Sends a JSON stringified plain object. When the server receives it, it parses JSON and creates a Message using `new Message(parsed)`. If the original message wasn't signed, the resulting Message won't have a signature.

**Potential HEARTBEAT Origin**: If similar code exists for HEARTBEAT messages, it would send a plain JSON object stringified, which when parsed on the server would create an unsigned Message.

**Note**: This pattern is used for Pong messages, but no similar code found for HEARTBEAT.

## HEARTBEAT Message Analysis

### Current HEARTBEAT Handling
**Location**: `fabric-http/types/server.js:502-505`

**Behavior**:
- Receives HEARTBEAT messages
- Logs if debug enabled
- No action taken
- No response sent

### Message Reception Flow
**Location**: `fabric-http/types/server.js:454-478`

**Critical Code Path**:
```javascript
socket.on('message', async (msg) => {
  // If JSON string received
  const parsed = JSON.parse(data);
  if (parsed && parsed.type) {
    type = parsed.type;  // Extracts "HEARTBEAT"
  }
  if (parsed && typeof parsed === 'object' && !Buffer.isBuffer(parsed)) {
    message = new Message(parsed);  // Creates Message from plain object
  }
  // ...
  // Later checks signature
  if (!message.raw.signature.toString() && !systemMessageTypes.includes(messageType)) {
    console.trace('[SERVER]', 'Message has no signature:', message, message.header, message.body);
  }
});
```

**Key Insight**: If a plain JSON object `{"type":"HEARTBEAT"}` is sent over WebSocket, it will be parsed and converted to a Message using `new Message(parsed)`. This Message will NOT have a signature because the original JSON didn't include one.

### Potential HEARTBEAT Origins

1. **Beat Event Conversion** (NOT FOUND)
   - Service.trust() beat handler doesn't create HEARTBEAT
   - Service.beat() creates 'Generic' messages, not 'HEARTBEAT'
   - Sensemaker.beat() creates 'COMMIT' messages, not 'HEARTBEAT'
   - No code found converting beat → HEARTBEAT

2. **Direct Creation** (NOT FOUND)
   - No `Message.fromVector(['HEARTBEAT', ...])` found in codebase
   - No direct HEARTBEAT message creation found

3. **JSON Object Creation** (MOST LIKELY)
   - If code creates `{type: "HEARTBEAT"}` and sends as JSON string
   - Server parses it: `JSON.parse(data)` → `{type: "HEARTBEAT"}`
   - Server creates Message: `new Message(parsed)` → Unsigned Message
   - This matches the error pattern exactly

4. **Message.toObject() Conversion** (POSSIBLE)
   - If HEARTBEAT Message exists and `toObject()` is called
   - Then `JSON.stringify()` is applied
   - Then sent as JSON string via `bridge.send()` or `websocket.send()`
   - Server parses and creates unsigned Message

5. **Commit() Method Plain Object** (POSSIBLE)
   - `commit()` creates plain object `{@type: 'Transaction', '@data': {...}}`
   - If this object is somehow converted to `{type: "HEARTBEAT"}` format
   - Then sent as JSON, it would create unsigned HEARTBEAT

### Message Constructor Behavior
**Location**: `fabric/types/message.js:88-139`

**When `new Message({type: "HEARTBEAT"})` is called**:
```javascript
constructor (input = {}) {
  // ...
  this.raw.signature = Buffer.alloc(64);  // Initialized to all zeros

  if (input.data && input.type) {
    this.type = input.type;  // Sets this.type = "HEARTBEAT"
    // Sets type code in raw buffer
    // Sets this.data from input.data
  }

  // ⚠️ If input.signature is not provided, signature remains all zeros
}
```

**Key Point**: If a plain object `{type: "HEARTBEAT"}` is passed to `new Message()`, the Message will:
- Have `type = "HEARTBEAT"` ✅
- Have `raw.signature` as all zeros (no signature) ❌
- This matches the error pattern exactly!

### Most Likely Scenario

Based on the error showing `{"type":"HEARTBEAT"}` (not `{"@type":"HEARTBEAT"}`), the most likely origin is:

**Code creates plain object `{type: "HEARTBEAT"}` → JSON.stringify() → websocket.send() → Server parses → `new Message(parsed)` → Creates unsigned Message**

**Flow**:
```
1. Code creates: {type: "HEARTBEAT"}
2. Code sends: JSON.stringify({type: "HEARTBEAT"}) → "{\"type\":\"HEARTBEAT\"}"
3. Server receives: JSON string
4. Server parses: JSON.parse(data) → {type: "HEARTBEAT"}
5. Server creates: new Message({type: "HEARTBEAT"})
6. Message has: type = "HEARTBEAT", signature = all zeros
7. Server checks: !message.raw.signature.toString() → true
8. Server logs: "Message has no signature"
```

**Search Strategy**:
1. Look for code that creates `{type: "HEARTBEAT"}` or `{type: 'HEARTBEAT'}`
2. Look for code that calls `JSON.stringify()` on objects with `type: "HEARTBEAT"`
3. Look for code that sends JSON strings via `bridge.send()` or `websocket.send()`
4. Check if `commit()` or store handlers somehow create HEARTBEAT objects
5. Check if error handlers convert failed broadcasts to HEARTBEAT

## Recommendations

1. **Fix broadcast() to handle both Messages and plain objects**
2. **Fix handleFabricMessage() to convert Message to Buffer**
3. **Search for any code that creates `{type: "HEARTBEAT"}` objects**
4. **Search for any code that calls `toObject()` on HEARTBEAT messages**
5. **Add logging to identify the exact creation point**

## Protocol Flow Summary

### Message Creation → Sending Flow

```
1. Message Created
   ├─ Message.fromVector(['Type', data])
   ├─ new Message(object)
   └─ Message.fromBuffer(buffer)

2. Message Signed (Optional)
   └─ message.signWithKey(key)

3. Message Sent
   ├─ message.toBuffer() → socket.send(buffer)  [Binary]
   ├─ JSON.stringify(message.toObject()) → websocket.send(json)  [JSON String]
   └─ message → broadcast() → message.toBuffer() → socket.send(buffer)

4. Message Received
   ├─ Buffer → Message.fromBuffer() → Message instance
   └─ JSON String → JSON.parse() → new Message(parsed) → Message instance

5. Message Processed
   └─ Switch on message.type → Handle or log
```

### Event-Driven Flow

```
Service.beat()
  → Creates Message.fromVector(['Generic', {...}])
    → this.emit('beat', beat)
      → Service.trust() _handleBeat handler
        → Logs only (doesn't broadcast)

Service.commit()
  → Creates plain object {@type: 'Transaction', '@data': {...}}
    → this.emit('message', message)
      → Service.trust() _handleMessage handler
        → _handleTrustedMessage()
          → this.emit('message')
            → HTTP Server handleFabricMessage() (if overridden)
              → this.agent.broadcast(message)  [P2P]
    → this.broadcast(message)  [WebSocket] ⚠️ FAILS - plain object
```

## Next Steps

1. **Search for HEARTBEAT object creation**:
   - `grep -r "type.*HEARTBEAT\|HEARTBEAT.*type"` (case-insensitive)
   - Look for `{type: "HEARTBEAT"}` or `type: 'HEARTBEAT'`

2. **Search for toObject() + send pattern**:
   - `grep -r "toObject.*send\|send.*toObject"`
   - Check if HEARTBEAT messages use this pattern

3. **Add debug logging**:
   - Log all messages passed to `handleFabricMessage()`
   - Log all messages passed to `broadcast()`
   - Log all JSON strings sent via `websocket.send()`

4. **Check commit() method**:
   - The `commit()` method passes plain objects to `broadcast()`
   - This will fail at runtime, but might be caught and converted somewhere
   - Check if error handlers convert these to HEARTBEAT

5. **Check Message constructor**:
   - When `new Message(parsed)` is called with `{type: "HEARTBEAT"}`
   - The Message is created but won't have a signature
   - This matches the error pattern exactly

