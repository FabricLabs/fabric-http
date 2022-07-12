import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeGlobals from 'rollup-plugin-node-globals';
import nodePolyfills from 'rollup-plugin-polyfill-node';

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
      nodeGlobals(),
      nodePolyfills(),
      commonjs({ include: /node_modules/, transformMixedEsModules:true}),
      resolve(),
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
      nodeGlobals(),
      nodePolyfills(),
      commonjs({
        transformMixedEsModules: true}),
      resolve({	
        browser: true		
      })
    ],
    external: []
  }
];
