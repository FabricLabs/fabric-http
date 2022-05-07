import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const packageJson = require('./package.json');

export default [
  {
    input: 'components/index.js',
    output: [
      {
        file: 'assets/components.js',
        format: 'cjs'
      }
    ],
    plugins: [
      resolve(),
      commonjs()
    ]
  },
  {
    input: 'module.js',
    output: [
      {
        file: 'assets/fabric.http.js',
        format: 'es'
      },
      {
        file: 'builds/esm/fabric.http.js',
        format: 'esm'
      }
    ],
    plugins: [
      resolve(),
      commonjs()
    ]
  }
];
