// Monads
import * as BootstrapMonad from './contracts/bootstrap';

// Types
import * as HTTPClient from './types/client';
import * as HTTPServer from './types/server';

// Components
import * as Bridge from './components/bridge';

// Locals
const NAME = '@fabric/http';

// Module
export default {
  BootstrapMonad: BootstrapMonad,
  Bridge: Bridge,
  HTTPClient: HTTPClient,
  HTTPServer: HTTPServer,
  NAME: NAME
};
