'use strict';

const webpack = require('webpack');
const path = require('path');

module.exports = {
  entry: './scripts/index.js',
  // devtool: 'source-map',
  target: 'web',
  output: {
    path: path.resolve(__dirname, 'assets/scripts'),
    filename: 'index.min.js'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production'),
        APP_ENV: JSON.stringify('browser')
      }
    })
  ]
};
