/**
 * Arrival-driven tile playback. Jobs are ordered by time then cell, but no job
 * waits for a complete frame. Only the newest accepted version of a cell lives
 * in the scene. Monotonic stamps include the loop number, not just frame index.
 * The supplied loader owns network/decode limits and returns one disposable group.
 */
export function createProgressiveTiles({
  THREE,
  frames,
  loadTileFrame,
  concurrency = () => 6,
  loop = () => true,
  startIndex = 0,
  autoplay = true,
  onFirstTile = () => {},
}) {
  const root = new THREE.Group();
  root.name = 'Tiles · hiển thị ngay';
  root.visible = true;
  const bounds = new THREE.Box3();
  const fromBox = (box) =>
    new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max));
  const entries = frames.map((frame) => {
    const byCell = new Map();
    for (const tile of frame.tiles) {
      // configure_tiles.py emits one voxels_new directory per frame.
      const key = tile.name;
      if (!key || byCell.has(key)) throw new Error('Tên ô tile bị thiếu hoặc trùng.');
      byCell.set(key, tile);
      if (tile.bounds) bounds.union(fromBox(tile.bounds));
    }
    if (frame.bounds) bounds.union(fromBox(frame.bounds));
    return byCell;
  });
  const keys = [...new Set(entries.flatMap((entry) => [...entry.keys()]))].sort();
  if (!keys.length) throw new Error('Chuỗi không có tile Gaussian để hiển thị.');
  const passSize = keys.length * frames.length;
  const totalFiles = entries.reduce((sum, entry) => sum + entry.size, 0);
  root.getBoundingBox = () => bounds;
  const cells = new Map();
  const jobs = new Set();
  const failedFiles = new Set();
  let controller = new AbortController();
  let generation = 0;
  let disposed = false;
  let running = true;
  let finished = false;
  let everReady = false;
  let next = startIndex * keys.length;
  let onceLimit = autoplay ? null : next + keys.length;
  let stopBoundary = loop() ? Infinity : passSize;
  let newest = -1;
  let updates = 0;
  let clears = 0;
  let stale = 0;
  let failures = 0;
  let lastError = '';
  let updateRate = 0;
  let sampleUpdates = 0;
  let sampleStart = null;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const settleReady = (value) => {
    resolveReady?.(value);
    resolveReady = null;
  };
  const isCurrent = (job) => !disposed && job.generation === generation && !job.signal.aborted;

  function apply(job, group) {
    if (!isCurrent(job) || (cells.get(job.key)?.stamp ?? -1) >= job.stamp) {
      group?.dispose();
      if (isCurrent(job)) stale++;
      return;
    }
    const previous = cells.get(job.key)?.group;
    if (previous) {
      root.remove(previous);
      previous.dispose();
    }
    cells.set(job.key, { stamp: job.stamp, group });
    newest = Math.max(newest, job.stamp);
    if (group) {
      bounds.union(group.getBoundingBox());
      group.visible = true;
      root.add(group);
      updates++;
      sampleUpdates++;
      if (!everReady) {
        everReady = true;
        onFirstTile(root);
        settleReady(true);
      }
    } else if (previous) {
      clears++;
    }
  }

  function limit() {
    return onceLimit ?? stopBoundary;
  }

  function completeIfDone() {
    if (disposed || !running) return;
    const active = [...jobs].some((job) => job.generation === generation);
    if (next >= limit() && !active) {
      running = false;
      finished = true;
      settleReady(everReady || failures === 0);
    }
    if (!everReady && failedFiles.size >= totalFiles) {
      running = false;
      finished = true;
      controller.abort();
      settleReady(false);
    }
  }

  async function execute(job) {
    try {
      const frame = frames[job.index];
      const group = await loadTileFrame(
        {
          ...frame,
          fastFrame: null,
          bounds: job.tile.bounds,
          tiles: [job.tile],
          totalBytes: job.tile.bytes,
          totalSplats: job.tile.splats,
          emptyTiles: 0,
        },
        { signal: job.signal, wanted: () => isCurrent(job) },
      );
      apply(job, group);
    } catch (cause) {
      if (isCurrent(job)) {
        failures++;
        failedFiles.add(job.tile.url);
        lastError = `${frames[job.index].name}/${job.key}: ${cause.message}`;
        // Keep the old cell on a fetch/decode error; other jobs continue.
      }
    } finally {
      jobs.delete(job);
      completeIfDone();
    }
  }

  function tick(now) {
    if (disposed) return;
    sampleStart ??= now;
    if (now - sampleStart >= 1000) {
      updateRate = (sampleUpdates * 1000) / (now - sampleStart);
      sampleUpdates = 0;
      sampleStart = now;
    }
    if (!running) return;
    if (loop()) stopBoundary = Infinity;
    else if (!Number.isFinite(stopBoundary)) {
      stopBoundary = Math.max(1, Math.ceil(next / passSize)) * passSize;
    }
    const slots = Math.max(1, Math.min(12, Number(concurrency()) || 6));
    // Yield after a bounded amount of empty-cell work, even in an empty stretch.
    let work = 0;
    while (jobs.size < slots && next < limit() && work++ < 64) {
      const ordinal = next++;
      const stamp = Math.floor(ordinal / keys.length);
      const index = stamp % frames.length;
      const key = keys[ordinal % keys.length];
      const job = {
        ordinal,
        stamp,
        index,
        key,
        tile: entries[index].get(key),
        generation,
        signal: controller.signal,
      };
      if (!job.tile) {
        // Absence in a complete manifest is a newer empty cell, not a network error.
        apply(job, null);
      } else {
        jobs.add(job);
        void execute(job);
      }
    }
    completeIfDone();
  }

  function pause() {
    if (disposed) return;
    running = false;
    for (const job of jobs) {
      if (job.generation === generation) next = Math.min(next, job.ordinal);
    }
    controller.abort();
    generation++;
    controller = new AbortController();
    updateRate = 0;
    sampleUpdates = 0;
    sampleStart = null;
    // Late decode completions are disposed, never shown while paused.
  }

  function play() {
    if (disposed) return;
    onceLimit = null;
    if (finished && next >= stopBoundary) {
      next = Math.max(passSize, Math.ceil(next / passSize) * passSize);
      stopBoundary = loop() ? Infinity : next + passSize;
    }
    failedFiles.clear();
    finished = false;
    running = true;
    sampleStart = null;
  }

  function dispose() {
    if (disposed) return;
    pause();
    disposed = true;
    for (const { group } of cells.values()) {
      if (group) {
        root.remove(group);
        group.dispose();
      }
    }
    cells.clear();
    settleReady(false);
  }

  function state() {
    const visible = [...cells.values()].filter((cell) => cell.group);
    const stamps = visible.map((cell) => cell.stamp);
    return {
      ready: everReady,
      running,
      finished,
      updates,
      clears,
      stale,
      failures,
      lastError,
      updateRate,
      cellCount: keys.length,
      visibleCells: visible.length,
      pending: jobs.size,
      latestIndex: newest < 0 ? startIndex : newest % frames.length,
      minStamp: stamps.length ? Math.min(...stamps) : -1,
      maxStamp: stamps.length ? Math.max(...stamps) : -1,
      memoryBytes: visible.reduce((sum, cell) => sum + (cell.group.cacheBytes || 0), 0),
    };
  }
  root.dispose = dispose;
  return { root, ready, state, tick, play, pause, dispose };
}
