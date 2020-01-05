'use strict';

const Component = require('./component');

/**
 * Prompt the user for some input with a {@link Steps}.
 * @extends {Component}
 */
class Steps extends Component {
  /**
   * The {@link Steps} {@link Component} provides an interrupting prompt for the
   * user to answer.  Progress is blocked until the prompt is complete, and no
   * computations will take place until user input is provided.
   * @param  {Object} [settings={}] Settings for the {@link Steps}.
   * @return {Component}            Instance of the the {@link Component}.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      title: 'Steps',
      description: 'A list of steps.',
      controls: false,
      content: 'Nothing to see here.  Move along, adventurer.',
      current: null,
      steps: [
        {
          title: 'Step 0:',
          icon: 'anvil',
          description: 'Configure your client.',
          validator: '_validateSteps'
        }
      ],
      methods: {},
      handle: 'maki-steps'
    }, settings);

    this.state = {
      clock: 0,
      steps: this.settings.steps,
      content: this.settings.content,
      methods: this.settings.methods
    };

    return this;
  }

  connectedCallback () {
    super.connectedCallback();

    console.log('[MAKI:STEPS]', 'connected!  current clock:', this.state.clock);

    window.app.circuit._registerMethod('_advanceStep', this._advanceStep.bind(this));

    let target = document.querySelector(`.maki-step[data-step="${this.state.clock}"]`);
    let others = document.querySelectorAll(`.maki-step:not([data-step="${this.state.clock}"])`);

    $(target).show();
    $(others).hide();
  }

  _advanceStep (event) {
    event.preventDefault();

    this.state.clock = this.state.clock++;

    let elements = document.querySelectorAll('.tab');

    console.log('candidate elements:', elements);

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];

      $(element).removeClass('active');

      if (element.getAttribute('data-tab') == i) {
        element.className += ' active';
      }
    }
  }

  _getInnerHTML () {
    let html = `<div class="ui segment">`;
    let progress = parseFloat(1 / this.settings.steps.length, 2);

    html += `<div class="ui top attached evenly spaced steps">`;
    for (let i = 0; i < this.settings.steps.length; i++) {
      let step = this.settings.steps[i];
      html += `<div class="step">`;
      if (step.icon) html += `<i class="${step.icon} icon"></i>`;
      html += `<div class="content">`;
      html += `<div class="title">${step.title}</div>`;
      html += `<div class="description">${step.description}</div>`;
      html += `</div>`;
      html += `</div>`;
    }
    html += '</div>';

    html += `<div class="ui bottom attached segment">`;

    html += `<div class="ui blue indeterminate progress">`;
    html += `<div class="bar"><div class="progress">loading...</div></div>`;
    html += `</div>`;

    for (let i = 0; i < this.settings.steps.length; i++) {
      let step = this.settings.steps[i];
      html += `<div class="ui maki-step ${(step.active) ? ' active' : ' hidden'}${(this.status === 'loading') ? ' loading' : ''} segment" data-step="${i}">`;
      html += `<div class="content">${step.content + ''}</div>`;
      html += `</div>`;
    }

    html += `</div>`;

    if (this.settings.controls) {
      html += `<div class="ui segment controls">`;
      html += `<div class="ui buttons"><div class="ui button">Back</div><div class="ui button" data-action="_advanceStep">Forward</div></div>`;
      html += `</div>`;
    }

    html += '</div>';
    html += `</div>`;

    return html;
  }
}

module.exports = Steps;
