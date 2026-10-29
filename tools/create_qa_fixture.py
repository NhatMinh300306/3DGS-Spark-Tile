"""Create a tiny synthetic SH1 dataset for Spark decoder QA, never Redandblack data."""
import json
import math
import struct
import shutil
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from configure_tiles import prepare_tiles

root = Path(__file__).resolve().parents[1] / 'dist' / 'qa-fixture'
props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2']
props += ['f_rest_' + str(i) for i in range(9)]
props += ['opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
for layer in (1, 8):
    for frame in range(1450, 1454):
        folder = root / f'layer_{layer}' / f'frame_{frame}'
        (folder / 'voxels_new').mkdir(parents=True, exist_ok=True)
        boxes = {}
        for tile in (0, 1):
            count = 32 if layer == 1 else 16
            data = bytearray()
            for i in range(count):
                a = i * math.tau / count
                values = {'x': tile - 0.5 + 0.15 * math.cos(a), 'y': 0.25 * math.sin(a),
                          'z': (frame - 1450) * 0.05, 'f_dc_0': tile * 0.5, 'f_dc_1': 0.4,
                          'f_dc_2': -0.3, 'opacity': 3, 'scale_0': -3, 'scale_1': -3,
                          'scale_2': -3, 'rot_0': 1}
                values.update({'f_rest_' + str(n): 0.1 * ((n % 3) - 1) for n in range(9)})
                data.extend(struct.pack('<' + 'f' * len(props), *(values.get(p, 0) for p in props)))
            header = '\n'.join(['ply', 'format binary_little_endian 1.0', f'element vertex {count}',
                *['property float ' + p for p in props], 'end_header', '']).encode()
            name = f'x_{tile}y_0z_0'
            (folder / 'voxels_new' / (name + '.ply')).write_bytes(header + data)
            boxes[name] = {'leftBottom': [tile - 0.7, -0.3, -0.1], 'rightTop': [tile - 0.3, 0.3, 0.3]}
        (folder / 'voxel_new.json').write_text(json.dumps(boxes))
prepare_tiles(root, root)
print(root)

shutil.copy2(root.parents[1] / 'tests' / 'browser-spark.html', root.parent / 'qa-spark.html')
