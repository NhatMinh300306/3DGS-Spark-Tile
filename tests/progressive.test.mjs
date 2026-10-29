import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const importSource = (file) =>
  import(
    'data:text/javascript;base64,' +
      fs.readFileSync(new URL('../dist/' + file, import.meta.url)).toString('base64')
  );
const { createProgressiveTiles } = await importSource('progressive.js');
const { initSequence } = await importSource('sequence.js');
const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
class Group {
  constructor() {
    this.children = [];
    this.rotation = { x: 0 };
    this.visible = true;
  }
  add(child) {
    this.children.push(child);
  }
  remove(child) {
    this.children = this.children.filter((c) => c !== child);
  }
}
class Box3 {
  union() {
    return this;
  }
}
const THREE = { Group, Box3, MathUtils: { degToRad: (x) => (x * Math.PI) / 180 } };
const frames = (
  names = [
    ['a', 'b'],
    ['a', 'b'],
  ],
) =>
  names.map((names, index) => ({
    name: `frame_${1450 + index}`,
    format: 'tiles',
    emptyTiles: 2 - names.length,
    fastFrame: { url: `fast-${index}` },
    tiles: names.map((name) => ({
      name: name + '.ply',
      url: `${index}/${name}`,
      bytes: 8,
      splats: 2,
    })),
  }));
function loader() {
  const requests = [],
    groups = [];
  const load = (entry, options) => {
    assert.equal(entry.fastFrame, null, 'must bypass the v8 merged frame');
    assert.equal(entry.tiles.length, 1, 'one independently renderable tile');
    return new Promise((resolve, reject) => {
      requests.push({
        entry,
        options,
        reject,
        finish() {
          const group = new Group();
          group.tag = entry.tiles[0].url;
          group.cacheBytes = 100;
          group.getBoundingBox = () => new Box3();
          group.dispose = () => {
            assert(!group.disposed, 'double dispose');
            group.disposed = true;
          };
          groups.push(group);
          resolve(group);
          return group;
        },
      });
    });
  };
  return { requests, groups, load };
}
function setup(options = {}) {
  const l = loader();
  const player = createProgressiveTiles({
    THREE,
    frames: frames(),
    loadTileFrame: l.load,
    concurrency: () => 2,
    loop: () => false,
    ...options,
  });
  return { ...l, player };
}

test('first tile shows immediately; a slow sibling does not block the next frame; late results cannot rewind a cell', async () => {
  const h = setup();
  h.player.tick(0);
  const a0 = h.requests[0].finish();
  await flush();
  assert.equal(await h.player.ready, true);
  assert.deepEqual(h.player.root.children, [a0]);
  h.player.tick(1);
  assert.equal(h.requests[2].entry.name, 'frame_1451');
  const a1 = h.requests[2].finish();
  await flush();
  assert(a0.disposed);
  assert.deepEqual(h.player.root.children, [a1]);
  h.player.tick(2);
  const b1 = h.requests[3].finish();
  await flush();
  const b0 = h.requests[1].finish();
  await flush();
  assert(b0.disposed);
  assert.deepEqual(h.player.root.children, [a1, b1]);
  assert.equal(h.player.state().stale, 1);
  assert.equal(h.player.state().finished, true);
  h.player.dispose();
  assert(h.groups.every((g) => g.disposed));
});

test('a newer empty cell removes the old tile and also rejects an older late tile', async () => {
  for (const finishOld of [true, false]) {
    const h = setup({ frames: frames([['a', 'b'], ['a']]), concurrency: () => 3 });
    h.player.tick(0);
    if (finishOld) h.requests[1].finish();
    else h.requests[0].finish();
    await flush();
    h.player.tick(1); // b is absent from frame 1, while its a tile is still pending.
    assert(!h.player.root.children.some((g) => g.tag === '0/b'));
    if (!finishOld) {
      const late = h.requests[1].finish();
      await flush();
      assert(late.disposed, 'empty-cell tombstone prevents a ghost from reappearing');
    } else assert.equal(h.player.state().clears, 1);
    h.player.dispose();
    h.requests[2].finish();
    if (finishOld) h.requests[0].finish();
    await flush();
    assert(h.groups.every((g) => g.disposed));
  }
});

test('loop stamps are monotonic even when a previous loop finishes late', async () => {
  const h = setup({ frames: frames([['a'], ['a']]), loop: () => true });
  h.player.tick(0);
  h.requests[1].finish();
  await flush();
  h.player.tick(1);
  const loop2 = h.requests[2].finish();
  await flush();
  const late = h.requests[0].finish();
  await flush();
  assert(late.disposed);
  assert.deepEqual(h.player.root.children, [loop2]);
  assert.equal(h.player.state().maxStamp, 2);
  h.player.dispose();
});

test('pause freezes the image, aborts jobs, and resume retries without exceeding the in-flight limit', async () => {
  const h = setup();
  h.player.tick(0);
  const a0 = h.requests[0].finish();
  await flush();
  h.player.pause();
  assert(h.requests[1].options.signal.aborted);
  h.player.play();
  h.player.tick(1);
  assert.equal(h.requests.length, 3, 'cancelled job still occupies a slot until it settles');
  h.player.pause();
  const b0 = h.requests[1].finish();
  const retry = h.requests[2].finish();
  await flush();
  assert(b0.disposed && retry.disposed);
  assert.deepEqual(h.player.root.children, [a0]);
  h.player.play();
  h.player.tick(2);
  assert(h.player.state().pending <= 2);
  h.player.dispose();
  for (const req of h.requests.slice(3)) req.finish();
  await flush();
  assert(h.groups.every((g) => g.disposed));
});

test('tile errors preserve useful siblings, and all-failed startup terminates honestly', async () => {
  const h = setup({ frames: frames([['a', 'b']]) });
  h.player.tick(0);
  const a = h.requests[0].finish();
  h.requests[1].reject(new Error('HTTP 404'));
  await flush();
  assert.equal(await h.player.ready, true);
  assert.deepEqual(h.player.root.children, [a]);
  assert.match(h.player.state().lastError, /404/);
  h.player.dispose();
  const bad = setup({ frames: frames([['a']]), loop: () => true, concurrency: () => 1 });
  bad.player.tick(0);
  bad.requests[0].reject(new Error('HTTP 404'));
  await flush();
  assert.equal(await bad.player.ready, false);
  assert.equal(bad.player.state().finished, true);
  bad.player.dispose();
});

test('many loops retain only one decoded tile per cell; work on empty stretches is bounded', async () => {
  const h = setup({ loop: () => true });
  let completed = 0;
  for (let step = 0; step < 50; step++) {
    h.player.tick(step * 20);
    for (const request of h.requests.slice(completed)) request.finish();
    completed = h.requests.length;
    await flush();
    assert(h.player.root.children.length <= 2);
    assert.equal(h.player.state().memoryBytes, 200);
    assert(h.groups.filter((g) => !g.disposed).length <= 2);
  }
  h.player.dispose();
});

test('sequence integration supports progressive startup, pause, seek, resolution changes and mode comparison', async () => {
  const nodes = new Map();
  const defaults = {
    seqTileMode: 'progressive',
    tileConcurrency: '2',
    seqFPS: '30',
    seqRotation: '0',
  };
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id))
        nodes.set(id, {
          value: defaults[id] || '',
          checked: false,
          replaceChildren() {},
          append() {},
        });
      return nodes.get(id);
    },
    createElement: () => ({}),
  };
  const l = loader();
  const scene = new Group();
  let fits = 0;
  const player = initSequence({
    THREE,
    SplatMesh: class {},
    scene,
    createProgressiveTiles,
    loadTileFrame: l.load,
    fitMesh: () => {
      fits++;
    },
    setNavigation() {},
  });
  const next = { layer_1: frames(), layer_8: frames() };
  const opening = player.loadGroups(next, { format: 'tiles', autoplay: true });
  l.requests[0].finish();
  await flush();
  assert.equal(await opening, true);
  assert.equal(player.state().ready, true);
  assert.equal(player.metrics().content_fps, null);
  assert.equal(nodes.get('frameTimingControls').hidden, true);
  assert.equal(fits, 1);
  player.pause();
  l.requests[1].finish();
  await flush();
  assert.equal(player.state().progressive.visibleCells, 1);
  const changing = player.selectResolution('layer_8');
  assert.equal(l.groups.filter((g) => !g.disposed).length, 0);
  l.requests[2].finish();
  l.requests[3].finish();
  await changing;
  assert.equal(player.state().resolution, 'layer_8');
  assert.equal(fits, 1, 'keep camera when changing resolution');
  nodes.get('seqSeek').value = '1';
  nodes.get('seqSeek').oninput();
  l.requests[4].finish();
  l.requests[5].finish();
  await flush();
  assert.equal(player.state().playing, false);
  assert.equal(player.state().index, 1);
  player.deactivate();
  assert(l.groups.every((g) => g.disposed));
  assert.equal(player.state().visible, false);
});
