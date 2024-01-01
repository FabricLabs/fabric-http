const merge = require('lodash.merge');
const FabricComponent = require('../types/component');

class FabricIdentity extends FabricComponent {
  constructor (props) {
    super(props);

    this.settings = merge({
      explain: false,
      modalOpen: false,
      keys: []
    }, props);

    // TODO: prepare Fabric
    // i.e., use _state here, then import from getter and apply properties
    // _from_ @react
    this.state = {
      explain: true,
      identity: null,
      integrity: 'sha256-deadbeefbabe',
      status: 'PAUSED'
    };

    return this;
  }

  handleChange (e, v) {
    console.log('change:', e, v);
    // this.setState({ seed: e });
  }

  handleClose () {
    this.setState({ modalOpen: false });
  }

  isVisible () {
    if (this.state.explain) return true;
    return false;
  }

  _handleCardClick () {
    this.setState({ modalOpen: true });
  }

  _handleRestoreButtonClick () {
    this.setState({ modalOpen: true });
  }

  _handleGeneratorButtonClick () {
    this.setState({ modalOpen: true });
  }

  _handleGenerateKeyPress (e) {
    if (e.charCode === 32 || e.charCode === 13) {
      // Prevent the default action to stop scrolling when space is pressed
      e.preventDefault();
      console.log('Button received click with keyboard');
    }
  }

  _handleRestoreKeyPress (e) {
    if (e.charCode === 32 || e.charCode === 13) {
      // Prevent the default action to stop scrolling when space is pressed
      e.preventDefault();
      console.log('Button received click with keyboard');
    }
  }
}

module.exports = FabricIdentity;
