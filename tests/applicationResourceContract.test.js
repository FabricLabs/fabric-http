'use strict';

const assert = require('assert');
const {
  ARC_TYPE,
  buildApplicationResourceContract,
  isApplicationResourceContract,
  resourceCatalog
} = require('../functions/applicationResourceContract');

describe('@fabric/http applicationResourceContract', function () {
  it('builds an Application Resource Contract with contract id and capabilities', function () {
    const server = {
      settings: {
        name: 'test.http',
        description: 'Test node',
        cors: true,
        spaFallback: true,
        jsonRpc: { enabled: true, paths: ['/services/rpc'] },
        services: { audio: { address: '/devices/audio' } }
      },
      definitions: {
        Document: {
          name: 'Document',
          description: 'docs',
          definition: {
            route: '/documents',
            components: { list: 'DocumentList', view: 'DocumentView' }
          },
          routes: { list: '/documents', view: '/documents/:id' }
        }
      }
    };
    const doc = buildApplicationResourceContract(server, {
      services: {
        peering: {
          endpointBasePath: '/services/peering',
          kind: 'PeeringCapability'
        }
      },
      fabricCapabilities: { p2p: true, webrtcSignaling: true },
      status: { oracleAttestation: { '@type': 'OracleAttestation', kind: 'PeeringCapability' } }
    });
    assert.strictEqual(doc['@type'], ARC_TYPE);
    assert.strictEqual(doc.version, 1);
    assert.strictEqual(doc.name, 'test.http');
    assert.ok(doc.contract && typeof doc.contract.id === 'string' && doc.contract.id.length > 0);
    assert.strictEqual(doc.contract.messageType, 'CONTRACT_PUBLISH');
    assert.ok(doc.resources.Document);
    assert.strictEqual(doc.resources.Document.routes.list, '/documents');
    assert.ok(doc.services.peering);
    assert.strictEqual(doc.services.peering.endpointBasePath, '/services/peering');
    assert.ok(doc.services.rpc && doc.services.rpc.paths.includes('/services/rpc'));
    assert.ok(doc.services.audio);
    assert.strictEqual(doc.capabilities.http.cors, true);
    assert.strictEqual(doc.capabilities.http.jsonRpc, true);
    assert.strictEqual(doc.capabilities.fabric.p2p, true);
    assert.ok(doc.status && doc.status.oracleAttestation);
    assert.ok(isApplicationResourceContract(doc));
  });

  it('resourceCatalog flattens FabricResource-like instances', function () {
    const cat = resourceCatalog({
      Peer: {
        name: 'Peer',
        description: 'peers',
        definition: { route: '/peers', components: { list: 'PeerList' } },
        routes: { list: '/peers', view: '/peers/:id' }
      }
    });
    assert.strictEqual(cat.Peer.route, '/peers');
    assert.strictEqual(cat.Peer.components.list, 'PeerList');
  });
});
