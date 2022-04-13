'use strict';

const webpack = require('webpack');
const path = require('path');

// Plugins
const WebpackAssetsManifest = require('webpack-assets-manifest');
// const ServiceWorkerWebpackPlugin = require('serviceworker-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: 'index.js',
  // devtool: 'source-map',
  target: 'web',
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
            plugins: removeEmpty([ifDev('react-refresh/babel')]),
          },
        },
        exclude: /node_modules/,
        include: [path.resolve(__dirname, 'src')],
      },
      {
        test: /\.(js)$/,
        use: [{
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', {
                "targets": "defaults"
              }],
              '@babel/preset-react',
              {
                  'plugins': ['@babel/plugin-proposal-class-properties']
              }
            ],
          }
        }],
        include: [
          path.resolve(__dirname, './'),
          /c360-structured-tree-component/
        ],
      },
    ]
  },
  output: {
    path: path.resolve(__dirname, 'assets/scripts'),
    filename: 'index.min.js',
    chunkFilename: '[id]-[chunkhash].js'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production'),
        APP_ENV: JSON.stringify('browser')
      }
    }),
    new WebpackAssetsManifest({
      publicPath: '/scripts',
      integrity: true,
      output: '../assets/manifest.json',
      merge: true
    }),
    /* new ServiceWorkerWebpackPlugin({
      entry: path.join(__dirname, 'scripts/worker.js'),
      filename: '../worker.js'
    }) */
  ]
};
