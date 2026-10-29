// Test scheduling, coordinates and resource ownership without pretending to render on a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { buildTileGroups, createTileLoader } = await import(
  'data:text/javascript;base64,' +
    fs.readFileSync(new URL('../dist/tiles.js', import.meta.url)).toString('base64')
);
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
const manifest = () => ({
  schema: 'splat-lab-tiles-v1',
  coordinateSpace: 'world',
  defaultLayer: 'layer_8',
  layers: ['layer_1', 'layer_8'].map((id) => ({
    id,
    frames: [1451, 1450].map((frame) => ({
      id: frame,
      emptyTiles: 2,
      tiles: [1, 2, 3, 4].map((tile) => ({
        path: `${id}/frame_${frame}/voxels_new/tile ${tile}.ply`,
        splats: 2,
        bytes: 8,
      })),
    })),
  })),
});
const manifestUrl = 'https://user.github.io/repository/data/redandblack_tiles/tiles.json';
const entry = () => buildTileGroups(manifest(), manifestUrl).layer_1[0];
const options = () => ({ signal: new AbortController().signal, wanted: () => true });

class Group {
  constructor() {
    this.children = [];
    this.position = { x: 0, y: 0, z: 0 };
  }
  add(mesh) {
    this.children.push(mesh);
  }
  remove(mesh) {
    this.children = this.children.filter((child) => child !== mesh);
  }
}
class Box3 {
  constructor() {
    this.min = Infinity;
    this.max = -Infinity;
  }
  union(box) {
    this.min = Math.min(this.min, box.min);
    this.max = Math.max(this.max, box.max);
  }
}
const response = (size = 8) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(size) });

test('manifest preserves layer identifiers, frame grouping and project-relative encoded URLs', () => {
  const groups = buildTileGroups(manifest(), manifestUrl);
  assert.deepEqual(Object.keys(groups), ['layer_1', 'layer_8']);
  assert.deepEqual(
    groups.layer_1.map((frame) => frame.name),
    ['frame_1450', 'frame_1451'],
  );
  assert.equal(groups.layer_1[0].tiles.length, 4);
  assert.equal(groups.layer_1[0].emptyTiles, 2);
  assert.equal(groups.layer_1[0].totalBytes, 32);
  assert.equal(
    groups.layer_1[0].tiles[0].url,
    'https://user.github.io/repository/data/redandblack_tiles/layer_1/frame_1450/voxels_new/tile%201.ply',
  );
  const bad = manifest();
  bad.layers[1].frames.pop();
  assert.throws(() => buildTileGroups(bad, manifestUrl), /cùng danh sách/);
  const traversal = manifest();
  traversal.layers[0].frames[0].tiles[0].path = '../other.ply';
  assert.throws(() => buildTileGroups(traversal, manifestUrl), /không hợp lệ/);
});

test('network continues during decode, both pools are bounded, and coordinates remain unchanged', async () => {
  const meshes = [],
    progress = [];
  let fetching = 0,
    maxFetching = 0,
    decoding = 0,
    maxDecoding = 0,
    fetched = 0;
  let fetchedAtFirstDecode = 0;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  class Mesh extends Group {
    constructor(args) {
      super();
      assert.equal(args.lod, false);
      this.numSplats = 2;
      this.index = meshes.length;
      meshes.push(this);
      decoding++;
      maxDecoding = Math.max(maxDecoding, decoding);
      this.initialized = delay(20).then(() => {
        decoding--;
        if (!fetchedAtFirstDecode) fetchedAtFirstDecode = fetched;
      });
    }
    getBoundingBox() {
      return { min: this.index * 10, max: this.index * 10 + 1 };
    }
    dispose() {
      assert(!this.disposed);
      this.disposed = true;
    }
  }
  const load = createTileLoader({
    THREE: { Group, Box3 },
    SplatMesh: Mesh,
    concurrency: () => 2,
    decodeConcurrency: () => 2,
    fetcher: async () => {
      fetching++;
      maxFetching = Math.max(maxFetching, fetching);
      await delay(1);
      fetching--;
      fetched++;
      return response();
    },
  });
  const group = await load(entry(), { ...options(), onProgress: (value) => progress.push(value) });
  assert.equal(group.children.length, 4);
  assert.equal(group.visible, false);
  assert.equal(maxFetching, 2);
  assert.equal(maxDecoding, 2);
  assert(fetchedAtFirstDecode > 2, 'downloads are not blocked by the two running decodes');
  assert.deepEqual(group.getBoundingBox(), Object.assign(new Box3(), { min: 0, max: 31 }));
  assert(
    meshes.every((mesh) => mesh.position.x === 0 && mesh.position.y === 0 && mesh.position.z === 0),
  );
  assert.equal(progress.at(-1).loaded, 4);
  assert.equal(progress.at(-1).bytes, 32);
  group.dispose();
  group.dispose();
  assert(meshes.every((mesh) => mesh.disposed));
  assert.equal(group.children.length, 0);
});

test('one missing tile fails the whole frame and disposes every decoded sibling', async () => {
  const meshes = [];
  class Mesh extends Group {
    constructor() {
      super();
      this.numSplats = 2;
      this.initialized = Promise.resolve();
      meshes.push(this);
    }
    getBoundingBox() {
      return { min: 0, max: 1 };
    }
    dispose() {
      this.disposed = true;
    }
  }
  let count = 0;
  const load = createTileLoader({
    THREE: { Group, Box3 },
    SplatMesh: Mesh,
    concurrency: () => 1,
    fetcher: async () => (++count === 3 ? { ok: false, status: 404 } : response()),
  });
  await assert.rejects(load(entry(), options()), /frame_1450\/tile 3.ply: HTTP 404/);
  assert(meshes.length >= 1);
  assert(meshes.every((mesh) => mesh.disposed));
});

test('cancellation aborts downloads and cleans a decoder that finishes after the scene changes', async () => {
  let finish, mesh;
  class Mesh extends Group {
    constructor() {
      super();
      this.numSplats = 2;
      mesh = this;
      this.initialized = new Promise((resolve) => {
        finish = resolve;
      });
    }
    dispose() {
      this.disposed = true;
    }
    getBoundingBox() {
      throw new Error('cancelled tile must never enter the group');
    }
  }
  const controller = new AbortController();
  let aborted = false,
    count = 0;
  const load = createTileLoader({
    THREE: { Group, Box3 },
    SplatMesh: Mesh,
    concurrency: () => 2,
    fetcher: (url, { signal }) =>
      ++count === 1
        ? Promise.resolve(response())
        : new Promise((resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new Error('AbortError'));
              },
              { once: true },
            );
          }),
  });
  const pending = load(entry(), { signal: controller.signal, wanted: () => true });
  const rejection = assert.rejects(pending, /hủy|AbortError/);
  await flush();
  controller.abort();
  finish();
  await rejection;
  assert.equal(aborted, true);
  assert.equal(mesh.disposed, true);
});

test('an empty frame makes no network requests, and a changed tile size is rejected before decode', async () => {
  const load = createTileLoader({
    THREE: { Group, Box3 },
    SplatMesh: class {
      constructor() {
        throw new Error('must not decode');
      }
    },
    fetcher: async () => response(7),
  });
  await assert.rejects(load(entry(), options()), /Kích thước PLY/);
  const group = await load(
    { ...entry(), tiles: [], emptyTiles: 4, totalBytes: 0, totalSplats: 0 },
    options(),
  );
  assert.equal(group.children.length, 0);
  assert.equal(group.emptyTiles, 4);
  group.dispose();
});

test('fast frame uses one HTTP request and one Spark mesh, with JSON bounds and all splats', async () => {
  const source = manifest();
  for (const layer of source.layers)
    for (const frame of layer.frames) {
      frame.fastFrame = {
        path: `fast_frames/${layer.id}/frame_${frame.id}.ply`,
        bytes: 32,
        splats: 8,
        revision: 'abcdef0123456789abcd',
      };
      frame.bounds = { min: [-2, -1, 0], max: [2, 1, 2] };
    }
  const frame = buildTileGroups(source, manifestUrl).layer_1[0];
  let requests = 0,
    constructed = 0,
    prepared = 0;
  class Vector3 {
    constructor(x) {
      this.x = x;
    }
  }
  class Bounds extends Box3 {
    constructor(min, max) {
      super();
      if (min) {
        this.min = min.x;
        this.max = max.x;
      }
    }
  }
  const load = createTileLoader({
    THREE: { Group, Box3: Bounds, Vector3 },
    SplatMesh: class extends Group {
      constructor(args) {
        super();
        constructed++;
        assert.equal(args.fileName, 'frame_1450.ply');
        this.numSplats = 8;
        this.initialized = Promise.resolve();
      }
      getBoundingBox() {
        throw new Error('must use JSON bounds');
      }
      dispose() {}
    },
    fetcher: async (url) => {
      requests++;
      assert.match(url, /\/fast_frames\/layer_1\/frame_1450.ply\?v=abcdef0123456789abcd$/);
      return response(32);
    },
    prepareMesh: async () => {
      prepared++;
    },
  });
  const group = await load(frame, options());
  assert.equal(requests, 1);
  assert.equal(constructed, 1);
  assert.equal(prepared, 1);
  assert.equal(group.children.length, 1);
  assert.equal(group.tileSplats, 8);
  assert.equal(group.tileCount, 4);
  assert.equal(group.fastFrame, true);
  assert.equal(group.getBoundingBox().min, -2);
  assert.equal(group.getBoundingBox().max, 2);
  assert.equal(group.timings.requests, 1);
  assert(group.cacheBytes > 0);
  group.dispose();
});

test('raw-byte budget holds back new downloads independently of network slots', async () => {
  let finish,
    fetched = 0;
  const controller = new AbortController();
  const load = createTileLoader({
    THREE: { Group, Box3 },
    rawBudgetBytes: 8,
    concurrency: () => 6,
    decodeConcurrency: () => 2,
    SplatMesh: class extends Group {
      constructor() {
        super();
        this.numSplats = 2;
        this.initialized = new Promise((resolve) => {
          finish = resolve;
        });
      }
      dispose() {}
    },
    fetcher: async () => {
      fetched++;
      return response();
    },
  });
  const pending = load(entry(), { signal: controller.signal, wanted: () => true });
  const rejected = assert.rejects(pending, /hủy/);
  await flush();
  assert.equal(fetched, 1, 'only one 8-byte item fits the raw-byte budget');
  controller.abort();
  finish();
  await rejected;
});
