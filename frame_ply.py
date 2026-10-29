"""Lossless offline concatenation of Gaussian PLY vertices. Python standard library only."""
import hashlib
from pathlib import Path

SCALAR_SIZES = {'char': 1, 'uchar': 1, 'int8': 1, 'uint8': 1, 'short': 2, 'ushort': 2,
                'int16': 2, 'uint16': 2, 'int': 4, 'uint': 4, 'int32': 4, 'uint32': 4,
                'float': 4, 'float32': 4, 'double': 8, 'float64': 8}

def vertex_layout(path):
    with Path(path).open('rb') as stream:
        if stream.readline().strip() != b'ply':
            raise ValueError(f'Not a PLY: {path}')
        fmt, count, element, properties = None, None, None, []
        for _ in range(8192):
            line = stream.readline(8192)
            if not line or stream.tell() > 1048576:
                raise ValueError(f'Invalid PLY header: {path}')
            words = line.decode('ascii').split()
            if not words:
                continue
            if words[0] == 'end_header':
                break
            if words[0] == 'format':
                fmt = words[1]
            elif words[0] == 'element':
                element = words[1]
                if element == 'vertex':
                    count = int(words[2])
                elif int(words[2]):
                    raise ValueError(f'Fast frame expects vertex-only Gaussian PLY: {path}')
            elif words[0] == 'property' and element == 'vertex':
                properties.append(' '.join(words))
        else:
            raise ValueError(f'Invalid PLY header: {path}')
        if fmt not in ('ascii', 'binary_little_endian') or count is None:
            raise ValueError(f'Unsupported Gaussian PLY: {path}')
        return fmt, count, properties, stream.tell()


def merge_frame(root, tiles, output):
    """Copy original vertex records unchanged, including SH and every scalar property."""
    output = Path(output)
    layouts = [vertex_layout(Path(root) / tile['path']) for tile in tiles]
    if not layouts:
        return None
    fmt, _, properties, _ = layouts[0]
    if any(layout[0] != fmt or layout[2] != properties for layout in layouts):
        raise ValueError(f'PLY properties/format differ within frame: {output}. Use --no-pack-frames.')
    total = sum(layout[1] for layout in layouts)
    header = '\n'.join(['ply', f'format {fmt} 1.0', f'element vertex {total}', *properties,
                        'end_header', '']).encode('ascii')
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix('.ply.tmp')
    digest = hashlib.sha256()
    def write(stream, data):
        stream.write(data)
        digest.update(data)
    try:
        with temp.open('wb') as target:
            write(target, header)
            for tile, layout in zip(tiles, layouts):
                with (Path(root) / tile['path']).open('rb') as source:
                    source.seek(layout[3])
                    if fmt == 'ascii':
                        for _ in range(layout[1]):
                            line = source.readline()
                            if not line.strip():
                                raise ValueError(f'Missing ASCII vertex: {tile["path"]}')
                            write(target, line.rstrip(b'\r\n') + b'\n')
                    else:
                        # configure_tiles has already validated scalar types and payload size.
                        stride = sum(SCALAR_SIZES[prop.split()[1]] for prop in properties)
                        remaining = layout[1] * stride
                        while remaining:
                            chunk = source.read(min(4 * 1024 * 1024, remaining))
                            if not chunk:
                                raise ValueError(f'Truncated PLY: {tile["path"]}')
                            write(target, chunk)
                            remaining -= len(chunk)
        temp.replace(output)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    return {'bytes': output.stat().st_size, 'splats': total, 'revision': digest.hexdigest()[:20]}
