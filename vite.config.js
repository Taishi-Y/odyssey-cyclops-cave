// hmr: false = saving a file never reloads the running game by itself (reload manually to pick up changes)
export default { base: './', server: { port: 5188, host: '127.0.0.1', allowedHosts: ['.ts.net', 'taishis-macbook-air'], hmr: false }, build: { target: 'esnext' }, esbuild: { target: 'esnext' } };
