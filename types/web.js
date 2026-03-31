'use strict';

const Server = require('./server');
const Client = require('./client');
const SPA = require('./spa');
const Avatar = require('./avatar');
const FabricAvatar = require('../components/FabricAvatar');

module.exports = {
  Server: Server,
  Client: Client,
  Avatar: Avatar,
  FabricAvatar: FabricAvatar,
  App: SPA,
  SPA: SPA,
  Site: SPA
};
