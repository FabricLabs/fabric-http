const Application = require('../../components/application');
const AssetList = require('../../components/asset-list');
const AssetView = require('../../components/asset-view');
const Authority = require('../../components/authority');
const BrowserContent = require('../../components/browser-content');
const Canvas = require('../../components/canvas');
const ChannelCreator = require('../../components/channel-creator');
const ChannelList = require('../../components/channel-list');
const ChannelView = require('../../components/channel-view');
const CircuitList = require('../../components/circuit-list');
const CircuitView = require('../../components/circuit-view');
const Collection = require('../../components/collection');
const Component = require('../../components/component');
const ContentPage = require('../../components/content-page');
const Debug = require('../../components/debug');
const DepositForm = require('../../components/deposit-form');
const Document = require('../../components/document');
const ExampleList = require('../../components/example-list');
const FabricBalanceManager = require('../../components/FabricBalanceManager');
const FabricBridge = require('../../components/FabricBridge');
const FabricChannelManager = require('../../components/FabricChannelManager');
const FabricDebugger = require('../../components/FabricDebugger');
const FabricIdentity = require('../../components/FabricIdentity');
const FabricIdentityManager = require('../../components/FabricIdentityManager');
const FabricKeyForm = require('../../components/FabricKeyForm');
const FabricKeyList = require('../../components/FabricKeyList');
const FabricKeyManager = require('../../components/FabricKeyManager');
const FabricKeyPair = require('../../components/FabricKeyPair');
const FabricModal = require('../../components/FabricModal');
const FabricNodeList = require('../../components/FabricNodeList');
const FabricPeerList = require('../../components/FabricPeerList');
const FabricTransactionList = require('../../components/FabricTransactionList');
const History = require('../../components/history');
const IdentityItem = require('../../components/identity-item');
const IdentityPicker = require('../../components/IdentityPicker');
const Introduction = require('../../components/introduction');
const Masthead = require('../../components/masthead');
const Menu = require('../../components/menu');
const Modal = require('../../components/modal');
const PeerList = require('../../components/peer-list');
const Prompt = require('../../components/prompt');
const ResourceList = require('../../components/resource-list');
const ResourceView = require('../../components/resource-view');
const SearchBox = require('../../components/search-box');
const SeedEntryForm = require('../../components/SeedEntryForm');
const Sidebar = require('../../components/sidebar');
const Steps = require('../../components/steps');
const Table = require('../../components/table');
const TransactionBuilder = require('../../components/transaction-builder');
const TransactionList = require('../../components/transaction-list');
const TransactionView = require('../../components/transaction-view');
const WalletCard = require('../../components/wallet-card');
const WalletCreator = require('../../components/wallet-creator');
const WalletList = require('../../components/wallet-list');
const WalletView = require('../../components/wallet-view');
const Wallet = require('../../components/wallet');
const Welcome = require('../../components/welcome');

var components = /*#__PURE__*/Object.freeze({
  __proto__: null,
  Application: Application,
  AssetList: AssetList,
  AssetView: AssetView,
  Authority: Authority,
  BrowserContent: BrowserContent,
  Canvas: Canvas,
  ChannelCreator: ChannelCreator,
  ChannelList: ChannelList,
  ChannelView: ChannelView,
  CircuitList: CircuitList,
  CircuitView: CircuitView,
  Collection: Collection,
  Component: Component,
  ContentPage: ContentPage,
  Debug: Debug,
  DepositForm: DepositForm,
  Document: Document,
  ExampleList: ExampleList,
  FabricBalanceManager: FabricBalanceManager,
  FabricBridge: FabricBridge,
  FabricChannelManager: FabricChannelManager,
  FabricDebugger: FabricDebugger,
  FabricIdentity: FabricIdentity,
  FabricIdentityManager: FabricIdentityManager,
  FabricKeyForm: FabricKeyForm,
  FabricKeyList: FabricKeyList,
  FabricKeyManager: FabricKeyManager,
  FabricKeyPair: FabricKeyPair,
  FabricModal: FabricModal,
  FabricNodeList: FabricNodeList,
  FabricPeerList: FabricPeerList,
  FabricTransactionList: FabricTransactionList,
  History: History,
  IdentityItem: IdentityItem,
  IdentityPicker: IdentityPicker,
  Introduction: Introduction,
  Masthead: Masthead,
  Menu: Menu,
  Modal: Modal,
  PeerList: PeerList,
  Prompt: Prompt,
  ResourceList: ResourceList,
  ResourceView: ResourceView,
  SearchBox: SearchBox,
  SeedEntryForm: SeedEntryForm,
  Sidebar: Sidebar,
  Steps: Steps,
  Table: Table,
  TransactionBuilder: TransactionBuilder,
  TransactionList: TransactionList,
  TransactionView: TransactionView,
  WalletCard: WalletCard,
  WalletCreator: WalletCreator,
  WalletList: WalletList,
  WalletView: WalletView,
  Wallet: Wallet,
  Welcome: Welcome
});

const NAME = '@fabric/http';

var index = {
  components: components,
  name: NAME
};

export { NAME, index as default };
