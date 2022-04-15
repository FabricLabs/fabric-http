const Application = require('./application');
const AssetList = require('./asset-list');
const AssetView = require('./asset-view');
const Authority = require('./authority');
const BrowserContent = require('./browser-content');
const Canvas = require('./canvas');
const ChannelCreator = require('./channel-creator');
const ChannelList = require('./channel-list');
const ChannelView = require('./channel-view');
const CircuitList = require('./circuit-list');
const CircuitView = require('./circuit-view');
const Collection = require('./collection');
const Component = require('./component');
const ContentPage = require('./content-page');
const Debug = require('./debug');
const DepositForm = require('./deposit-form');
const Document = require('./document');
const ExampleList = require('./example-list');
const FabricBalanceManager = require('./FabricBalanceManager');
const FabricBridge = require('./FabricBridge');
const FabricChannelManager = require('./FabricChannelManager');
const FabricDebugger = require('./FabricDebugger');
const FabricIdentity = require('./FabricIdentity');
const FabricIdentityManager = require('./FabricIdentityManager');
const FabricKeyForm = require('./FabricKeyForm');
const FabricKeyList = require('./FabricKeyList');
const FabricKeyManager = require('./FabricKeyManager');
const FabricKeyPair = require('./FabricKeyPair');
const FabricModal = require('./FabricModal');
const FabricNodeList = require('./FabricNodeList');
const FabricPeerList = require('./FabricPeerListManager');
const FabricTransactionList = require('./FabricTransactionListManager');
const History = require('./history');
const IdentityItem = require('./identity-item');
const IdentityPicker = require('./IdentityPicker');
const Introduction = require('./introduction');
const Masthead = require('./masthead');
const Menu = require('./menu');
const Modal = require('./modal');
const PeerList = require('./peer-list');
const Prompt = require('./prompt');
const ResourceList = require('./resource-list');
const ResourceView = require('./resource-view');
const SearchBox = require('./search-box');
const SeedEntryForm = require('./SeedEntryForm');
const Sidebar = require('./sidebar');
const Steps = require('./steps');
const Table = require('./table');
const TransactionBuilder = require('./transaction-builder');
const TransactionList = require('./transaction-list');
const TransactionView = require('./transaction-view');
const WalletCard = require('./wallet-card');
const WalletCreator = require('./wallet-creator');
const WalletList = require('./wallet-list');
const WalletView = require('./wallet-view');
const Wallet = require('./wallet');
const Welcome = require('./welcome');

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
