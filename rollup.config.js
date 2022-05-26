import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default [
  {
    input: 'components/index.js',
    output: [
      {
        file: 'assets/components.js',
        format: 'iife',
        name: 'FabricComponents'
      }
    ],
    plugins: [
      resolve(),
      commonjs()
    ]
  },
  {
    input: 'scripts/index.js',
    output: [
      {
        file: 'assets/fabric.http.js',
        format: 'iife',
        name: 'FabricHTTP'
      },
      {
        file: 'builds/esm/fabric.http.js',
        format: 'esm'
      }
    ],
    plugins: [
      json(),
      resolve(),
      commonjs()
    ],
    external: ['react', 'react-dom']
  }
];
