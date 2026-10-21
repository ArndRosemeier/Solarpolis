# Solarpolis

A detailed 3D simulation set about 1000 years from now, starting inside a mature O'Neill cylinder in Earth orbit. Everything is procedural: the cylinder is a parametric blueprint, not a fixed model. Work in progress.

```sh
git clone --recurse-submodules https://github.com/ArndRosemeier/Solarpolis
npm install
npm run dev    # http://localhost:5210
npm test       # guards + fast tests, under the CI budget
```

Needs a browser with WebGPU. Rules for working on the code: [CLAUDE.md](CLAUDE.md). Design: [docs/design](docs/design/README.md).
