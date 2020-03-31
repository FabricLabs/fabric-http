'use strict';

// const Canvas = require('canvas');
const Key = require('@fabric/core/types/key');

class Avatar {
  constructor (settings = {}) {
    this.settings = Object.assign({
      font: 'assets/fonts/visitor-tt2-brk.ttf',
      width: 100,
      height: 100,
      handle: 'fabric-web-avatar'
    }, settings);
    this.key = new Key();
    // this.canvas = Canvas.createCanvas(this.settings.width, this.settings.height);
    // this.context = this.canvas.getContext('2d');
    return this;
  }

  async _drawAvatar () {
    let self = this;
    let image = new Canvas.Image();
    let font = await Canvas.registerFont(self.settings.font, {
      family: 'Visitor'
    });

    this.context.antialias = 'none';
    this.context.font = '12px Visitor';
    this.context.fillText('Hello, world! :)', 35, 45);

    return this;
  }

  toDataURI () {
    return `${this.canvas.toDataURL('image/png')}`;
  }

  render () {
    return `<fabric-web-avatar><img src="${this.toDataURI()}" class="crisply bordered" /></fabric-web-avatar>`;
  }
}

module.exports = Avatar;
