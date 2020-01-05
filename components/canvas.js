'use strict';

const Fabric = require('@fabric/core');
const History = require('./history');

class Canvas extends Fabric.App {
  constructor (entity = {}) {
    super(entity);

    this.config = Object.assign({
      height: 300,
      width: 400
    }, entity);

    this['@data'] = this.config;
    this.bindings = {
      'click': this._handleClick.bind(this),
      'touchstart': this._handleTouchStart.bind(this),
      'touchend': this._handleTouchEnd.bind(this),
      'touchcancel': this._handleTouchCancel.bind(this),
      'touchmove': this._handleTouchMove.bind(this)
    };

    this.element = document.createElement('canvas');
    this.context = this.element.getContext('2d');
    this.interactions = [];

    return this;
  }

  _copyTouch (touch) {
    return {
      identifier: touch.identifier,
      target: {
        x: touch.pageX,
        y: touch.pageY
      }
    };
  }

  _handleClick (event) {
    event.preventDefault();
    console.log('click:', event);
    return this;
  }

  _handleTouchStart (event) {
    event.preventDefault();
    let touches = event.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      let touch = this._copyTouch(touches[i]);
      this.interactions.push(touch);
    }

    return this;
  }

  _handleTouchCancel (event) {
    event.preventDefault();
    let touches = event.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      delete this.interaction[touches[i]];
    }

    return this;
  }

  _handleTouchEnd (event) {
    event.preventDefault();
    let touches = event.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      console.log('touch end:', touches[i]);
      delete this.interaction[touches[i]];
    }

    return this;
  }

  _handleTouchMove (event) {
    event.preventDefault();
    let touches = event.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      let touch = this._copyTouch(touches[i]);
      this.interactions.push(touch);
    }

    return this;
  }

  _screenRendered () {
    console.log('screen rendered:', this);
  }

  export () {
    this.element.toDataURL();
  }

  draw () {
    let canvas = document.querySelector('rpg-application canvas');
    let context = canvas.getContext('2d');

    context.clearRect(0, 0, canvas.width, canvas.height);
    images.context = context;

    //drawBackground();
    drawMap();
    drawPlayers();

    window.requestAnimationFrame(drawFrame);
  }

  async _drawLogin () {
    console.log('[RPG]', `Beginning login...`);
    console.log('[RPG]', `Application:`, this);

    let context = this.element.getContext('2d');

    this.element.fillStyle = '#ff0000';
    //this.element.fill();

    window.requestAnimationFrame(this._screenRendered.bind(this));

    let identities = await this.stash._GET(`/identities`);
    console.log('identities:', identities);

    let name = prompt('What is your name?');
  }

  render () {
    let history = new History();
    return `<rpg-canvas><canvas width="${this.config.width}" height="${this.config.height}" integrity="sha256:${this.id}"></canvas>${history.render()}</rpg-canvas>`;
  }
}

module.exports = Canvas;
