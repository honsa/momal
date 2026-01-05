// Binary draw protocol helpers (MOML v1)
(() => {
  'use strict';

  const Momal = window.Momal;
  if (!Momal) throw new Error('Momal core missing');

  const BIN_MAGIC = 'MOML';
  const BIN_VERSION = 1;
  const BIN_TYPE_STROKE = 1;

  function hexToRgb(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return { r: 0, g: 0, b: 0 };
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  function rgbToHex(r, g, b) {
    const to2 = (n) => n.toString(16).padStart(2, '0');
    return `#${to2(r & 255)}${to2(g & 255)}${to2(b & 255)}`;
  }

  function packBinaryStroke(seq, tsMs, colorHex, widthPx, points) {
    const { r, g, b } = hexToRgb(colorHex);
    const count = points.length;

    // header size = 22 bytes
    const buf = new ArrayBuffer(22 + count * 8);
    const dv = new DataView(buf);

    // magic
    dv.setUint8(0, BIN_MAGIC.charCodeAt(0));
    dv.setUint8(1, BIN_MAGIC.charCodeAt(1));
    dv.setUint8(2, BIN_MAGIC.charCodeAt(2));
    dv.setUint8(3, BIN_MAGIC.charCodeAt(3));

    dv.setUint8(4, BIN_VERSION);
    dv.setUint8(5, BIN_TYPE_STROKE);

    dv.setUint32(6, seq >>> 0, true);
    dv.setUint32(10, tsMs >>> 0, true);

    dv.setUint8(14, r);
    dv.setUint8(15, g);
    dv.setUint8(16, b);
    dv.setUint8(17, 0);

    const w10 = Math.max(1, Math.min(500, Math.round((Number(widthPx) || 3) * 10)));
    dv.setUint16(18, w10, true);
    dv.setUint16(20, count, true);

    let off = 22;
    for (let i = 0; i < count; i++) {
      const p = points[i];
      dv.setFloat32(off, p.x, true);
      dv.setFloat32(off + 4, p.y, true);
      off += 8;
    }

    return buf;
  }

  function tryDecodeBinaryFrame(data) {
    if (!(data instanceof ArrayBuffer)) return null;
    if (data.byteLength < 22) return null;

    const dv = new DataView(data);
    const magic = String.fromCharCode(
      dv.getUint8(0),
      dv.getUint8(1),
      dv.getUint8(2),
      dv.getUint8(3)
    );
    if (magic !== BIN_MAGIC) return null;

    const version = dv.getUint8(4);
    if (version !== BIN_VERSION) return null;

    const type = dv.getUint8(5);
    if (type !== BIN_TYPE_STROKE) return null;

    const seq = dv.getUint32(6, true);
    const tsMs = dv.getUint32(10, true);

    const r = dv.getUint8(14);
    const g = dv.getUint8(15);
    const b = dv.getUint8(16);

    const width = dv.getUint16(18, true) / 10;
    const count = dv.getUint16(20, true);

    const expectedLen = 22 + count * 8;
    if (count < 2 || expectedLen > data.byteLength) return null;

    const pts = new Array(count);
    let off = 22;
    for (let i = 0; i < count; i++) {
      const x = dv.getFloat32(off, true);
      const y = dv.getFloat32(off + 4, true);
      off += 8;
      pts[i] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }

    return {
      seq,
      tsMs,
      payload: {
        t: 'stroke',
        p: pts,
        c: rgbToHex(r, g, b),
        w: width
      }
    };
  }

  Momal.binary = {
    BIN_MAGIC,
    BIN_VERSION,
    packBinaryStroke,
    tryDecodeBinaryFrame,
  };
})();

