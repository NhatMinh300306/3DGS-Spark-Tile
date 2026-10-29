/** Explicit HTTP tile manifests; layer identifiers are resolution choices. */
export function buildTileGroups(manifest, manifestUrl) {
  if (manifest?.schema !== 'splat-lab-tiles-v1' || manifest.coordinateSpace !== 'world') {
    throw new Error(
      'Manifest tile không hợp lệ. Chạy py configure_tiles.py; các tile cần chung hệ tọa độ.',
    );
  }
  if (!Array.isArray(manifest.layers) || !manifest.layers.length) {
    throw new Error('Manifest chưa có layer/resolution.');
  }
  const base = new URL('./', manifestUrl);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Manifest cần URL HTTP/HTTPS.');
  const validBounds = (box) =>
    box &&
    ['min', 'max'].every(
      (key) => Array.isArray(box[key]) && box[key].length === 3 && box[key].every(Number.isFinite),
    ) &&
    box.min.every((v, i) => v <= box.max[i]);
  const relativeURL = (path) => {
    if (
      typeof path !== 'string' ||
      path.includes('\\') ||
      path.includes(':') ||
      path.startsWith('/') ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !path.toLowerCase().endsWith('.ply')
    )
      throw new Error('Đường dẫn PLY trong manifest không hợp lệ.');
    return new URL(path.split('/').map(encodeURIComponent).join('/'), base).href;
  };
  const groups = Object.create(null);
  for (const layer of manifest.layers) {
    if (!/^layer_\d+$/i.test(layer.id) || groups[layer.id])
      throw new Error('Layer trùng hoặc không hợp lệ.');
    if (!Array.isArray(layer.frames) || !layer.frames.length)
      throw new Error(`${layer.id}: thiếu frame.`);
    const ids = new Set();
    groups[layer.id] = layer.frames
      .map((frame) => {
        if (
          !Number.isSafeInteger(frame.id) ||
          frame.id < 0 ||
          ids.has(frame.id) ||
          !Array.isArray(frame.tiles)
        ) {
          throw new Error(`${layer.id}: frame trùng hoặc không hợp lệ.`);
        }
        ids.add(frame.id);
        if (!frame.tiles.length && !(frame.emptyTiles > 0))
          throw new Error(`frame_${frame.id}: chưa có tile.`);
        const paths = new Set();
        const tiles = frame.tiles.map((tile) => {
          const path = tile.path;
          if (
            typeof path !== 'string' ||
            path.includes('\\') ||
            path.includes(':') ||
            path.startsWith('/') ||
            path.split('/').some((part) => !part || part === '.' || part === '..') ||
            !path.toLowerCase().endsWith('.ply') ||
            paths.has(path) ||
            !Number.isSafeInteger(tile.splats) ||
            tile.splats <= 0 ||
            !Number.isSafeInteger(tile.bytes) ||
            tile.bytes <= 0
          ) {
            throw new Error(`${layer.id}/frame_${frame.id}: thông tin tile không hợp lệ.`);
          }
          paths.add(path);
          return {
            ...tile,
            name: path.split('/').pop(),
            url: relativeURL(path),
            bounds: validBounds(tile.bounds) ? tile.bounds : null,
          };
        });
        let fastFrame = null;
        if (frame.fastFrame) {
          const file = frame.fastFrame;
          if (
            !Number.isSafeInteger(file.bytes) ||
            file.bytes <= 0 ||
            file.splats !== tiles.reduce((n, tile) => n + tile.splats, 0) ||
            !/^[a-f0-9]{20,64}$/.test(file.revision || '')
          )
            throw new Error('Fast frame không hợp lệ; chạy lại configure_tiles.py.');
          fastFrame = {
            ...file,
            name: file.path.split('/').pop(),
            url: relativeURL(file.path) + '?v=' + file.revision,
          };
        }
        return {
          fastFrame,
          bounds: validBounds(frame.bounds) ? frame.bounds : null,
          name: `frame_${frame.id}`,
          format: 'tiles',
          tiles,
          emptyTiles: frame.emptyTiles || 0,
          totalBytes: tiles.reduce((n, tile) => n + tile.bytes, 0),
          totalSplats: tiles.reduce((n, tile) => n + tile.splats, 0),
        };
      })
      .sort((a, b) => Number(a.name.slice(6)) - Number(b.name.slice(6)));
  }
  const reference = Object.values(groups)[0]
    .map((f) => f.name)
    .join(',');
  for (const frames of Object.values(groups)) {
    if (frames.map((f) => f.name).join(',') !== reference) {
      throw new Error('Các layer/resolution phải có cùng danh sách frame.');
    }
  }
  return groups;
}

/** Abortable FIFO gate. A single oversized item may run alone, avoiding deadlock. */
export function createGate(limit) {
  let used = 0;
  const queue = [];
  function drain() {
    while (queue.length) {
      const task = queue[0];
      if (used > 0 && used + task.weight > limit()) break;
      queue.shift();
      task.signal.removeEventListener('abort', task.abort);
      used += task.weight;
      let released = false;
      task.resolve(() => {
        if (released) return;
        released = true;
        used -= task.weight;
        drain();
      });
    }
  }
  return (signal, weight = 1) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Đã hủy tác vụ.'));
      const task = { signal, weight, resolve, reject };
      task.abort = () => {
        const i = queue.indexOf(task);
        if (i >= 0) queue.splice(i, 1);
        reject(new Error('Đã hủy tác vụ.'));
        drain();
      };
      signal.addEventListener('abort', task.abort, { once: true });
      queue.push(task);
      drain();
    });
}

/** Network, raw-byte budget and Spark initialization have independent limits. */
export function createTileLoader({
  THREE,
  SplatMesh,
  fetcher = (...args) => fetch(...args),
  concurrency = () => 6,
  decodeConcurrency = () => 2,
  rawBudgetBytes = 128 * 1048576,
  prepareMesh = () => {},
}) {
  const clamp = (n, fallback, max) => Math.max(1, Math.min(max, Math.floor(Number(n) || fallback)));
  const network = createGate(() => clamp(concurrency(), 6, 12));
  const decode = createGate(() => clamp(decodeConcurrency(), 2, 4));
  const rawMemory = createGate(() => rawBudgetBytes);
  return async function loadTileFrame(entry, { signal, wanted, onProgress = () => {} }) {
    const group = new THREE.Group();
    Object.assign(group, {
      name: entry.name,
      visible: false,
      tileCount: entry.tiles.length,
      emptyTiles: entry.emptyTiles,
      sourceBytes: entry.fastFrame?.bytes || entry.totalBytes,
      tileSplats: entry.totalSplats,
      fastFrame: Boolean(entry.fastFrame),
      cacheBytes: 0,
    });
    const bounds = new THREE.Box3();
    const fromBox = (box) =>
      new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max));
    if (entry.bounds) bounds.union(fromBox(entry.bounds));
    group.getBoundingBox = () => bounds;
    let disposed = false;
    group.dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const mesh of [...group.children]) {
        group.remove(mesh);
        mesh.dispose();
      }
    };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const watcher = setInterval(() => {
      if (!wanted()) abort();
    }, 25);
    let completed = 0,
      fetchedBytes = 0,
      firstError = null;
    const started = performance.now();
    // These are sums of task durations, not additive frame wall-clock time when tasks overlap.
    const timings = { fetchMs: 0, decodeMs: 0, boundsMs: 0, uploadSubmitMs: 0, requests: 0 };
    const active = () => {
      if (signal.aborted || controller.signal.aborted || !wanted())
        throw new Error('Đã hủy tải frame.');
    };
    const files = entry.fastFrame ? [entry.fastFrame] : entry.tiles;
    const report = () =>
      onProgress({
        frame: entry.name,
        loaded: completed,
        total: files.length,
        bytes: fetchedBytes,
        totalBytes: group.sourceBytes,
        fastFrame: group.fastFrame,
      });
    async function loadOne(file) {
      let releaseBytes, releaseDecode, mesh;
      try {
        active();
        releaseBytes = await rawMemory(controller.signal, file.bytes);
        const releaseNetwork = await network(controller.signal);
        let bytes;
        try {
          active();
          const begin = performance.now();
          const response = await fetcher(file.url, { signal: controller.signal });
          timings.requests++;
          if (!response.ok) throw new Error(`HTTP ${response.status} — ${file.url}`);
          bytes = await response.arrayBuffer();
          timings.fetchMs += performance.now() - begin;
          if (bytes.byteLength !== file.bytes)
            throw new Error('Kích thước PLY khác manifest; chạy lại configure_tiles.py.');
        } finally {
          releaseNetwork();
        }
        active();
        fetchedBytes += bytes.byteLength;
        report();
        // Network slots are already released: the next file can download during this wait.
        releaseDecode = await decode(controller.signal);
        active();
        const begin = performance.now();
        mesh = new SplatMesh({ fileBytes: bytes, fileName: file.name, lod: false });
        bytes = null;
        await mesh.initialized;
        timings.decodeMs += performance.now() - begin;
        releaseDecode();
        releaseDecode = null;
        releaseBytes();
        releaseBytes = null;
        active();
        if (mesh.numSplats !== file.splats)
          throw new Error('Số Gaussian khác manifest; chạy lại configure_tiles.py.');
        const beforeBounds = performance.now();
        if (!entry.bounds) bounds.union(file.bounds ? fromBox(file.bounds) : mesh.getBoundingBox());
        timings.boundsMs += performance.now() - beforeBounds;
        const beforeUpload = performance.now();
        await prepareMesh(mesh);
        timings.uploadSubmitMs += performance.now() - beforeUpload;
        active();
        // Approximate CPU + GPU source arrays. Renderer working buffers and driver overhead are additional.
        const packed = mesh.packedSplats;
        let arrayBytes = packed?.packedArray?.byteLength || 0;
        for (const value of Object.values(packed?.extra || {})) {
          if (ArrayBuffer.isView(value)) arrayBytes += value.byteLength;
        }
        group.cacheBytes += Math.max(arrayBytes * 2, file.splats * 112) + 65536;
        group.add(mesh);
        mesh = null;
        completed++;
        report();
      } catch (error) {
        if (mesh) mesh.dispose();
        if (!firstError) firstError = new Error(`${entry.name}/${file.name}: ${error.message}`);
        controller.abort();
        throw firstError;
      } finally {
        releaseDecode?.();
        releaseBytes?.();
      }
    }
    try {
      active();
      report();
      const results = await Promise.allSettled(files.map(loadOne));
      if (firstError) throw firstError;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
      active();
      group.timings = { ...timings, preparationMs: performance.now() - started };
      return group;
    } catch (error) {
      group.dispose();
      throw error;
    } finally {
      clearInterval(watcher);
      signal.removeEventListener('abort', abort);
    }
  };
}
